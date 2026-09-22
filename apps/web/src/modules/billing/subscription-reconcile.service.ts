import "server-only";

import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { fetchInvoiceDetail } from "@/modules/billing/billing-gateway";
import { settlePayment } from "@/modules/billing/subscription-payment.service";
import { paisaToRupees } from "@/modules/billing/softmato/money";
import { recordSoftmatoPayment } from "@/modules/billing/subscription-webhook.service";
import { outstandingFor } from "@/modules/billing/subscription.service";
import { SubscriptionInvoiceModel } from "@hostel/db/models/SubscriptionInvoice";
import { SubscriptionPaymentModel } from "@hostel/db/models/SubscriptionPayment";

/**
 * The second way to learn that money arrived: asking, rather than being told.
 *
 * `docs/INTEGRATION.md` §6.4 names two authoritative answers and this is the
 * other one — *"when a `getTransaction()` call **you made** says the payment
 * succeeded"*. Not a query parameter, not the customer arriving somewhere: a
 * server-side read of Softmato's own ledger.
 *
 * ## Why it is needed at all
 *
 * A webhook is fetched by Softmato's server, so it needs a hostname Softmato
 * can reach. A laptop does not have one. On a local deployment the redirect
 * works — the browser goes wherever it is told — but the delivery never
 * arrives, so provisioning would wait forever on a machine that cannot be
 * called. This closes that, using the outbound direction a laptop *does* have.
 *
 * ## Why it reads the invoice rather than the transaction
 *
 * `getTransaction` needs a transaction id, and the id only ever reaches us on
 * the webhook we are here to do without. `getInvoice` is addressed by
 * something we have known since we raised it, and its `paid_minor` is the same
 * ledger a transaction would be reported from.
 *
 * The cost is that this learns *how much* arrived without learning *which
 * payment* it was, so the row it writes carries no transaction number and no
 * receipt document until a webhook fills them in. That is a real gap and it is
 * left visible in the data rather than papered over with a made-up reference.
 *
 * ## Idempotency is arithmetic, not a flag
 *
 * It settles the difference between what Softmato says was paid and what we
 * have already recorded. Run it twice and the second run finds nothing owing.
 * Run it after a webhook has already settled the payment and it finds nothing
 * owing. There is no "already reconciled" bit to get out of step, because the
 * two totals *are* the state.
 */

export type ReconcileResult =
  | { kind: "settled"; amount: number }
  | { kind: "nothing_new" }
  | { kind: "no_document" }
  | { kind: "unknown_invoice" };

export async function reconcileInvoiceFromSoftmato(
  invoiceId: string | Types.ObjectId,
): Promise<ReconcileResult> {
  await connectToDatabase();

  const invoice = await SubscriptionInvoiceModel.findById(invoiceId).lean<{
    _id: Types.ObjectId;
    amount: number;
    hostelId: Types.ObjectId;
    softmatoInvoiceNo?: string | null;
    status: string;
    subscriptionId: Types.ObjectId;
  } | null>();

  if (!invoice) return { kind: "unknown_invoice" };
  if (invoice.status === "VOID") return { kind: "nothing_new" };
  if (!invoice.softmatoInvoiceNo) return { kind: "no_document" };

  const detail = await fetchInvoiceDetail(invoice.softmatoInvoiceNo).catch(() => null);

  if (!detail) return { kind: "no_document" };

  /*
   * Softmato names each payment behind `paid_minor` now. Recorded one by one
   * under its own transaction number — the same path a webhook takes — so the
   * owner's receipt is Softmato's, and the webhook that follows finds the work
   * done. The arithmetic below is only for a Softmato too old to say.
   */
  if (detail.payments) {
    let settled = 0;

    for (const payment of detail.payments) {
      const result = await recordSoftmatoPayment(
        invoice,
        payment.transaction_id,
        paisaToRupees(payment.amount_minor),
      );

      if (result.action === "settled") settled += paisaToRupees(payment.amount_minor);
    }

    return settled > 0 ? { amount: settled, kind: "settled" } : { kind: "nothing_new" };
  }

  /*
   * Their paisa against our whole rupees. Softmato's `paid_minor` is the gross
   * that reached them; a provider fee is their cost, not a deduction from what
   * the hostel paid, so it is not subtracted here.
   */
  const paidRemote = Math.round(detail.paid_minor / 100);
  const { paid: paidLocal } = await outstandingFor(invoice);
  const difference = paidRemote - paidLocal;

  /*
   * Zero is the ordinary answer and negative is possible: a cash payment we
   * recorded off-rail is money Softmato has never heard of, so our total can
   * legitimately exceed theirs. Neither is an error, and neither writes a row.
   */
  if (difference <= 0) return { kind: "nothing_new" };

  const payment = await SubscriptionPaymentModel.create({
    amount: difference,
    hostelId: invoice.hostelId,
    invoiceId: invoice._id,
    method: "SOFTMATO",
    status: "PENDING",
    subscriptionId: invoice.subscriptionId,
  });

  await settlePayment(String(payment._id));

  return { amount: difference, kind: "settled" };
}
