import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { siteUrl } from "@/lib/site";
import { getGatewayCredentials } from "@/modules/finance/gateway/secret-store";
import { getProvider } from "@/modules/finance/gateway/registry";
import type { GatewayProviderName } from "@/modules/finance/gateway/provider.types";
import { PaymentIntentModel } from "@hostel/db/models/PaymentIntent";

/**
 * Re-derives an existing checkout's provider handoff, for the relay page.
 *
 * ## Why this exists
 *
 * eSewa's v2 checkout is a **form POST**: a set of fields whose signature covers
 * them positionally, in the order they are declared. `createPaymentIntent`
 * returns those fields to the client because the resident's own browser has to
 * be the thing that arrives at eSewa — a POST from our server would give eSewa
 * *our* session, and the payment could not complete.
 *
 * That works on the web, where the client is a browser and can submit a form. On
 * a phone it does not: `expo-web-browser` and `Linking.openURL` open **URLs**,
 * Chrome blocks a `data:` URL carrying a self-submitting form from top-level
 * navigation, and re-signing on the client would mean shipping the merchant
 * secret to a handset. So the app opens a page on our origin, and that page
 * carries the form. The signing stays on the server; the browser still makes the
 * request.
 *
 * ## Why it re-derives rather than stores
 *
 * Nothing new is persisted. Every input to the signature is already on the
 * intent (`reference`, `amount`) or resolvable from it (the hostel's
 * credentials, the return and failure URLs), and eSewa's `createIntent` is a
 * pure function of those — so calling it again produces byte-identical fields
 * and the same signature. Storing a signed blob would be a second copy of the
 * truth that can drift from the intent it belongs to, and a secret-derived value
 * sitting in the database for no reason.
 *
 * **It does not create an intent.** `createPaymentIntent` counts attempts and
 * writes a row; this reads one. Opening the relay page twice is not two
 * attempts.
 *
 * ## Why it is reachable without a session
 *
 * It is opened by the phone's *browser*, which has no app session — that is the
 * entire problem being solved. The reference is the capability, exactly as it is
 * for the provider itself, and three things bound what it can be used for: the
 * intent must still be `CREATED`, it must not have expired (15 minutes), and
 * the page can only ever start a payment **towards** an invoice. Someone holding
 * a stranger's reference can see an amount and pay their rent for them. They
 * cannot read anything about the resident, and nothing here settles money —
 * only `verifyPaymentIntent` does, and only after asking the provider.
 */

export class HandoffError extends Error {
  constructor(
    message: string,
    readonly reason: "EXPIRED" | "NOT_FORM_POST" | "NOT_FOUND" | "NOT_PAYABLE",
  ) {
    super(message);
    this.name = "HandoffError";
  }
}

export type FormPostHandoff = {
  amount: number;
  /** Emission order is the signature's order. Never re-sort this. */
  fields: Record<string, string>;
  provider: GatewayProviderName;
  reference: string;
  sandbox: boolean;
  url: string;
};

type IntentRecord = {
  _id: Types.ObjectId;
  amount: number;
  attempt: number;
  expiresAt: Date;
  hostelId: Types.ObjectId;
  invoiceId: Types.ObjectId;
  mode: "LIVE" | "SANDBOX";
  provider: GatewayProviderName;
  reference: string;
  residentId: Types.ObjectId;
  status: string;
};

export async function buildFormPostHandoff(
  reference: string,
): Promise<FormPostHandoff> {
  await connectToDatabase();

  const intent = await PaymentIntentModel.findOne({
    reference,
  }).lean<IntentRecord | null>();

  if (!intent) {
    throw new HandoffError("This payment link is not valid.", "NOT_FOUND");
  }

  /*
   * `CREATED` is the only payable state. A SUCCEEDED intent must not be
   * re-presented — the resident would pay a second time for a settled invoice
   * and we would owe them a refund — and a FAILED or EXPIRED one has to go back
   * through the app so a fresh attempt is counted.
   */
  if (intent.status !== "CREATED") {
    throw new HandoffError(
      "This payment has already been completed or cancelled.",
      "NOT_PAYABLE",
    );
  }

  if (new Date(intent.expiresAt).getTime() <= Date.now()) {
    throw new HandoffError("This payment link has expired.", "EXPIRED");
  }

  const credentials = await getGatewayCredentials(intent.hostelId, intent.provider);
  const adapter = getProvider(intent.provider);
  const base = siteUrl();

  /*
   * The same arguments `createPaymentIntent` passed, so the signature matches
   * what the app was originally handed. `attempt` and `reference` come off the
   * stored intent rather than being recounted — recounting would produce a
   * different reference and a payment nothing could be matched to.
   */
  const rebuilt = await adapter.createIntent({
    amount: intent.amount,
    attempt: intent.attempt,
    callbackUrl: `${base}/api/v1/webhooks/${intent.provider.toLowerCase()}`,
    credentials,
    failureUrl: `${base}/resident/payments/checkout/${intent.reference}?outcome=failed`,
    invoiceId: intent.invoiceId.toString(),
    reference: intent.reference,
    referenceCode: intent.reference,
    returnUrl: `${base}/resident/payments/checkout/${intent.reference}`,
  });

  if (rebuilt.handoff.kind !== "FORM_POST") {
    /*
     * A `REDIRECT` provider needs no relay — Khalti's launch URL is a URL, and
     * the app opens it directly so the wallet's own app can claim it. Sending
     * one through here would put a browser between the resident and an app that
     * already holds their session and their biometric unlock.
     */
    throw new HandoffError(
      "This provider does not need a relay page.",
      "NOT_FORM_POST",
    );
  }

  return {
    amount: intent.amount,
    fields: rebuilt.handoff.fields,
    provider: intent.provider,
    reference: intent.reference,
    sandbox: intent.mode === "SANDBOX",
    url: rebuilt.handoff.url,
  };
}
