import "server-only";

import { SoftmatoApiError, type TransactionView } from "@softmato/sdk";

import { softmato } from "./client";

/**
 * Asking Softmato, on the server, whether a payment actually happened.
 *
 * This is one of the two answers that count. The other is a verified webhook.
 * Everything else — the owner arriving back on our return page, a query
 * parameter, a `PENDING` row we wrote ourselves before showing a QR — is a
 * claim, not evidence.
 *
 * ## Which statuses mean "provision"
 *
 * Exactly one: `SUCCEEDED`. The rest are worth telling apart because the
 * screen says something different for each, but none of them turns a service
 * on.
 *
 * `RECONCILIATION_REQUIRED` is the one that catches people out. It means
 * Softmato and the provider disagree about this payment and a human is looking
 * at it. It is **not** a failure — telling the owner their payment failed and
 * inviting them to pay again is how one person pays twice. It is "not answered
 * yet", and the answer arrives later, as a webhook.
 */

export type PaymentOutcome =
  | { kind: "settled"; transaction: TransactionView }
  | { kind: "pending"; transaction: TransactionView }
  | { kind: "under_review"; transaction: TransactionView }
  | { kind: "not_completed"; transaction: TransactionView }
  | { kind: "unknown" };

/**
 * A transaction belonging to another application answers `404`, identically to
 * one that does not exist — deliberately, and there is no way to tell them
 * apart. So `unknown` covers both, and the screen must not say "no such
 * payment" as though that were a fact about the world.
 */
export async function readTransaction(
  transactionId: string,
): Promise<PaymentOutcome> {
  let transaction: TransactionView;

  try {
    transaction = await softmato().getTransaction(transactionId);
  } catch (error) {
    if (
      error instanceof SoftmatoApiError &&
      error.code === "RESOURCE_NOT_FOUND"
    ) {
      return { kind: "unknown" };
    }

    throw error;
  }

  return { kind: classify(transaction.status), transaction } as PaymentOutcome;
}

/**
 * The same words arrive on the webhook payload's `status`, so one classifier
 * serves both paths and neither can drift into treating a status differently
 * from the other.
 */
export function classify(
  status: string,
): "settled" | "pending" | "under_review" | "not_completed" {
  switch (status.toUpperCase()) {
    case "SUCCEEDED":
      return "settled";
    case "CREATED":
    case "PENDING":
      return "pending";
    case "RECONCILIATION_REQUIRED":
      return "under_review";
    default:
      /*
       * FAILED, CANCELLED, EXPIRED, REFUNDED, PARTIALLY_REFUNDED, REVERSED —
       * and anything added to the API after this was written. An unrecognised
       * status must not fall through to "settled": defaulting the other way is
       * the difference between an owner seeing "not completed" for a moment
       * and a hostel publishing for free.
       */
      return "not_completed";
  }
}
