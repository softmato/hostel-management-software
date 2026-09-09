import "server-only";

import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { fetchInvoiceDetail } from "@/modules/billing/billing-gateway";
import { resolveOwnedHostel } from "@/modules/billing/subscription-access";
import { SubscriptionInvoiceModel } from "@hostel/db/models/SubscriptionInvoice";

/**
 * What actually happened, asked of Softmato, for the page the owner lands on
 * coming back from checkout.
 *
 * ## Nothing here reads the URL
 *
 * The owner arrives at the return page by *clicking*, and they can arrive
 * there without having paid — a bookmark, a back button, a forwarded link, or
 * simply pressing cancel at the wallet. So the query string carries one thing,
 * our own invoice number, and it is treated as a *navigation* hint: which
 * purchase are you asking about. It is checked against rows this reader owns
 * before it is used, and the answer to "did they pay" comes from a server-side
 * call, never from a parameter. **Softmato puts no payment status in that URL,
 * and anything that looks like one did not come from them.**
 *
 * ## Why the invoice, not the transaction
 *
 * The obvious read is `getTransaction`, and it is the right one when you have
 * a transaction id. Here we do not: the id arrives on the webhook, and the
 * webhook may not have landed yet — the owner's browser is usually faster than
 * a server-to-server POST. `getInvoice` is addressed by something we have
 * known since we raised it, and its `paid_minor` is the same ledger the
 * transaction would be reported from.
 *
 * ## This reports; it does not provision
 *
 * Turning the service on is the webhook's job, and doing it here as well would
 * mean two paths racing to publish a hostel. So when this says the money
 * arrived and our own subscription has not caught up yet, the page says so and
 * waits, rather than reaching for the activation itself.
 */

export type ReturnState =
  | { kind: "paid"; invoiceNumber: string; planName: string; total: number }
  | {
      kind: "partial";
      balance: number;
      invoiceNumber: string;
      planName: string;
    }
  | { kind: "unpaid"; invoiceNumber: string; planName: string; total: number }
  | { kind: "void"; invoiceNumber: string }
  /** Raised locally, no document yet — or Softmato was unreachable just now. */
  | { kind: "pending_document"; invoiceNumber: string }
  | { kind: "unknown" };

export async function readReturnState(
  userId: string,
  invoiceNumber: string,
): Promise<ReturnState> {
  await connectToDatabase();

  const invoice = await SubscriptionInvoiceModel.findOne({
    invoiceNumber,
  }).lean<{
    hostelId: Types.ObjectId;
    planName: string;
    softmatoInvoiceNo?: string | null;
  } | null>();

  if (!invoice) return { kind: "unknown" };

  /*
   * Ownership, checked through the same widening the rest of the billing flow
   * uses — a public registration can resolve an owner to a different `User`
   * row than the one that was signed in when the form was typed, and a
   * narrower check here would refuse an owner their own receipt.
   *
   * A refusal is reported as `unknown`, exactly as a number that does not
   * exist. A reader probing invoice numbers learns nothing from the
   * difference.
   */
  try {
    await resolveOwnedHostel(invoice.hostelId.toString(), userId);
  } catch {
    return { kind: "unknown" };
  }

  if (!invoice.softmatoInvoiceNo) {
    return { invoiceNumber, kind: "pending_document" };
  }

  const detail = await fetchInvoiceDetail(invoice.softmatoInvoiceNo).catch(
    () => null,
  );

  if (!detail) return { invoiceNumber, kind: "pending_document" };

  if (detail.status === "void" || detail.status === "written_off") {
    return { invoiceNumber, kind: "void" };
  }

  if (detail.status === "paid") {
    return {
      invoiceNumber,
      kind: "paid",
      planName: invoice.planName,
      total: Math.round(detail.total_minor / 100),
    };
  }

  if (detail.status === "partially_paid") {
    return {
      balance: Math.round(detail.due_minor / 100),
      invoiceNumber,
      kind: "partial",
      planName: invoice.planName,
    };
  }

  /*
   * `unpaid` and `past_due` land here together. Both mean the invoice is still
   * open and still payable, which is the same thing to say to the reader: the
   * payment did not complete, and trying again is the normal path rather than
   * an error state.
   */
  return {
    invoiceNumber,
    kind: "unpaid",
    planName: invoice.planName,
    total: Math.round(detail.total_minor / 100),
  };
}
