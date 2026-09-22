import "server-only";

import { SubscriptionInvoiceModel } from "@hostel/db/models/SubscriptionInvoice";

import { fetchInvoiceDetail, issueInvoiceDocument } from "@/modules/billing/billing-gateway";
import { rupeesToPaisa } from "@/modules/billing/softmato/money";
import {
  invoiceDocumentInput,
  type InvoiceRecord,
} from "@/modules/billing/subscription.service";

/**
 * The Softmato document a checkout for `outstanding` rupees should address —
 * its id, which is what `POST /v1/checkout` takes.
 *
 * Checkout takes no amount: Softmato charges the document's own due, `total -
 * paid` (payment-core `sessions/create.ts`). So the original document is right
 * whenever their due is ours — unpaid, or part-paid by cash filed through them.
 * When part was paid where they never saw it (a proof confirmed here), their
 * due is too high, and exactly the balance gets a document of its own. The
 * caller has already raised the original (`ensureInvoiceRaised`).
 */
export async function checkoutDocumentFor(
  invoice: InvoiceRecord,
  outstanding: number,
): Promise<string> {
  const detail = await fetchInvoiceDetail(invoice.softmatoInvoiceNo as string);

  if (detail && detail.due_minor === rupeesToPaisa(outstanding)) {
    return invoice.softmatoInvoiceId as string;
  }

  const known = invoice.softmatoBalanceInvoices?.find((doc) => doc.amount === outstanding);

  if (known) return known.id;

  const base = await invoiceDocumentInput(invoice);

  // The number feeds only the external ref, so a retry for this same balance
  // gets this same document back rather than a second one.
  const raised = await issueInvoiceDocument({
    ...base,
    amount: outstanding,
    description: `Balance of ${invoice.invoiceNumber} — ${base.description}`,
    invoiceNumber: `${invoice.invoiceNumber}-B${outstanding}`,
  });

  await SubscriptionInvoiceModel.updateOne(
    { _id: invoice._id },
    {
      $addToSet: {
        softmatoBalanceInvoices: {
          amount: outstanding,
          id: raised.softmatoInvoiceId,
          no: raised.softmatoInvoiceNo,
        },
      },
    },
  );

  return raised.softmatoInvoiceId;
}

/** Every Softmato document behind this invoice: the original, then balances. */
export function softmatoDocumentNumbers(invoice: {
  softmatoBalanceInvoices?: { no: string }[] | null;
  softmatoInvoiceNo?: string | null;
}): string[] {
  return [
    ...(invoice.softmatoInvoiceNo ? [invoice.softmatoInvoiceNo] : []),
    ...(invoice.softmatoBalanceInvoices ?? []).map((doc) => doc.no),
  ];
}
