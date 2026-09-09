import "server-only";

import type { WebhookPayload } from "@softmato/sdk";
import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { paisaToRupees } from "@/modules/billing/softmato/money";
import { classify } from "@/modules/billing/softmato/transaction";
import { settlePayment } from "@/modules/billing/subscription-payment.service";
import { SubscriptionInvoiceModel } from "@hostel/db/models/SubscriptionInvoice";
import { SubscriptionPaymentModel } from "@hostel/db/models/SubscriptionPayment";

/**
 * Turning a verified webhook into a settled payment, exactly once.
 *
 * By the time anything here runs the signature has been checked over the raw
 * bytes and the delivery's age has been bounded, so the payload is Softmato's
 * words rather than a stranger's. What is left is the hard part: **a delivery
 * arrives more than once as a matter of course.** Retries continue until we
 * answer 2xx, and a network that drops our 200 is indistinguishable from one
 * that dropped their POST.
 *
 * So the handler is idempotent on `transaction_id`, and it is enforced in the
 * database rather than by checking first and writing second — two deliveries
 * processed concurrently both pass a check and only one can win a unique
 * index.
 *
 * ## What each event does
 *
 * Only `payment.success` provisions. Everything else is recorded and leaves
 * the invoice exactly where it was: **open, and payable again.** A cancelled
 * payment is an answer, not a failure — the owner changed their mind at the
 * wallet and a fresh attempt against the same invoice is the normal path.
 * Marking the invoice failed would close a door they are about to walk
 * through.
 */

export type WebhookResult =
  | { action: "settled"; paymentId: string }
  | { action: "already_settled"; paymentId: string }
  | { action: "recorded"; event: string }
  | { action: "ignored"; reason: string };

export async function applyWebhook(
  payload: WebhookPayload,
): Promise<WebhookResult> {
  await connectToDatabase();

  if (classify(payload.status) !== "settled" || payload.event !== "payment.success") {
    /*
     * Both conditions, not either. The event name says what happened and the
     * status says where the transaction ended up; provisioning on a
     * `payment.success` whose status is not `SUCCEEDED` would be trusting the
     * label over the fact.
     */
    return { action: "recorded", event: payload.event };
  }

  /*
   * The invoice is found by **Softmato's** number, which is what the payload
   * carries. Ours never crosses the wire, and looking it up by the handle we
   * were actually sent is what keeps this from depending on a mapping that
   * could go stale.
   */
  const invoice = await SubscriptionInvoiceModel.findOne({
    softmatoInvoiceNo: payload.invoice_id,
  }).lean<{
    _id: Types.ObjectId;
    hostelId: Types.ObjectId;
    subscriptionId: Types.ObjectId;
  } | null>();

  if (!invoice) {
    /*
     * Answered 2xx by the caller regardless: an invoice we do not recognise is
     * not going to start being recognised on the fourth retry, and holding the
     * delivery open buys nothing. It is logged loudly because it should be
     * impossible — the credential is scoped to this application, so the
     * invoice was raised by us.
     */
    return { action: "ignored", reason: "no invoice for that number" };
  }

  const amount = paisaToRupees(payload.amount);

  /*
   * Attach the transaction to the attempt that was waiting for it.
   *
   * `softmatoTransactionNo` is uniquely indexed, so this is a claim rather than
   * a write: the first delivery attaches it, and a concurrent second matches
   * nothing because the row it wanted is no longer `softmatoTransactionNo:
   * null`. The read below then finds it either way.
   */
  await SubscriptionPaymentModel.findOneAndUpdate(
    { invoiceId: invoice._id, softmatoTransactionNo: null, status: "PENDING" },
    { $set: { amount, softmatoTransactionNo: payload.transaction_id } },
    { sort: { createdAt: -1 } },
  );

  const attached = await SubscriptionPaymentModel.findOne({
    softmatoTransactionNo: payload.transaction_id,
  }).lean<{ _id: Types.ObjectId; status: string } | null>();

  /*
   * Before creating anything: was this money already counted by the other
   * authority?
   *
   * `subscription-reconcile.service.ts` settles from a server-side read of
   * Softmato's ledger, which learns *how much* arrived without learning
   * *which* transaction it was — so it leaves a settled row with no
   * transaction number. A webhook that turns up afterwards naming that same
   * payment must **label** that row, not add a second one, or the hostel is
   * recorded as having paid twice.
   *
   * Matched on the amount as well as the invoice, so a genuine second
   * instalment is still a second row.
   */
  const reconciled = attached
    ? null
    : await SubscriptionPaymentModel.findOneAndUpdate(
        {
          amount,
          invoiceId: invoice._id,
          method: "SOFTMATO",
          softmatoTransactionNo: null,
          status: "SETTLED",
        },
        { $set: { softmatoTransactionNo: payload.transaction_id } },
        { new: true, sort: { createdAt: -1 } },
      ).lean<{ _id: Types.ObjectId } | null>();

  if (reconciled) {
    return { action: "already_settled", paymentId: String(reconciled._id) };
  }

  /*
   * No attempt to attach to is a legitimate state, not an error. The owner may
   * have paid from a session opened on another device, or the write that
   * recorded the attempt may have been lost. The money arrived either way, so
   * the row is created from the payload rather than the payment being dropped
   * for want of a placeholder.
   */
  const paymentId =
    attached?._id ??
    ((
      await SubscriptionPaymentModel.create({
        amount,
        hostelId: invoice.hostelId,
        invoiceId: invoice._id,
        method: "SOFTMATO",
        softmatoTransactionNo: payload.transaction_id,
        status: "PENDING",
        subscriptionId: invoice.subscriptionId,
      })
    )._id as Types.ObjectId);

  if (attached?.status === "SETTLED") {
    return { action: "already_settled", paymentId: String(paymentId) };
  }

  await settlePayment(String(paymentId));

  return { action: "settled", paymentId: String(paymentId) };
}
