import "server-only";

import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import {
  fetchInvoiceDetail,
  softmatoDocsUrl,
} from "@/modules/billing/billing-gateway";
import { SubscriptionInvoiceModel } from "@hostel/db/models/SubscriptionInvoice";
import { SubscriptionPaymentModel } from "@hostel/db/models/SubscriptionPayment";

/**
 * Everything a hostel's own billing screen shows: what was billed, what was
 * paid, and where each document lives.
 *
 * ## Built from our rows, enriched from theirs
 *
 * The list, the ordering and the balances come from this database, because
 * they have to work when Softmato is unreachable and because a hostel's
 * billing screen should not depend on a third party being up. What comes from
 * Softmato is the *contents* of one document, fetched only when the reader
 * opens it — the line items, both parties, the plan copy we sent, and the
 * totals as their ledger has them.
 *
 * That split is also why `presentation` is worth reading back rather than
 * re-deriving locally: it is the plan description exactly as it was printed on
 * the invoice, so this screen and that document say the same thing without a
 * second copy to keep in sync. A plan renamed or repriced next month does not
 * rewrite what an owner already bought.
 *
 * ## Two numbers per document, both shown
 *
 * Ours is the one our emails quote and the one support will be asked about.
 * Theirs is the one on the PDF, carrying the fiscal year and the ledger
 * sequence, and is what an accountant will want. Showing only one of them
 * guarantees the owner is holding the other.
 */

export interface BillingInvoiceRow {
  amount: number;
  currency: string;
  /** Our own authenticated download route, or null before the paper exists. */
  documentUrl: string | null;
  dueAt: string | null;
  invoiceNumber: string;
  issuedAt: string | null;
  outstanding: number;
  paid: number;
  planName: string;
  cycleLabel: string;
  /** `INV-2083/84-000010`, once raised. */
  softmatoInvoiceNo: string | null;
  status: string;
}

export interface BillingPaymentRow {
  amount: number;
  documentUrl: string | null;
  /** `CASH` rows are our own record and carry no Softmato document. */
  method: string;
  paidAt: string | null;
  /** `eSewa`, `Khalti` — absent on cash. */
  provider: string | null;
  providerRef: string | null;
  receiptNumber: string | null;
  softmatoTransactionNo: string | null;
  status: string;
}

export interface BillingHistory {
  /** The integration guide Softmato hosts. Null when unconfigured. */
  docsUrl: string | null;
  invoices: BillingInvoiceRow[];
  payments: BillingPaymentRow[];
}

const CYCLE_LABELS: Record<string, string> = {
  annual: "Annual",
  halfYearly: "6 months",
  monthly: "Monthly",
};

export async function getBillingHistory(
  hostelId: string,
): Promise<BillingHistory> {
  await connectToDatabase();

  const id = new Types.ObjectId(hostelId);

  const [invoices, payments] = await Promise.all([
    SubscriptionInvoiceModel.find({ hostelId: id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean<
        Array<{
          _id: Types.ObjectId;
          amount: number;
          currency?: string;
          cycle: string;
          documentUrl?: string | null;
          dueAt?: Date | null;
          invoiceNumber: string;
          issuedAt?: Date | null;
          planName: string;
          softmatoInvoiceNo?: string | null;
          status: string;
        }>
      >(),
    SubscriptionPaymentModel.find({ hostelId: id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean<
        Array<{
          amount: number;
          gatewayReference?: string | null;
          method: string;
          receiptDocumentUrl?: string | null;
          receiptNumber?: string | null;
          settledAt?: Date | null;
          softmatoProvider?: string | null;
          softmatoTransactionNo?: string | null;
          status: string;
        }>
      >(),
  ]);

  /*
   * Paid-per-invoice in one aggregate rather than a query per row. Only
   * `SETTLED` counts, for the same reason it does everywhere else: a pending
   * attempt is a promise being waited on, and letting one reduce a balance
   * would show an owner a debt they have not actually cleared.
   */
  const settled = await SubscriptionPaymentModel.aggregate<{
    _id: Types.ObjectId;
    total: number;
  }>([
    { $match: { hostelId: id, status: "SETTLED" } },
    { $group: { _id: "$invoiceId", total: { $sum: "$amount" } } },
  ]);

  const paidByInvoice = new Map(
    settled.map((row) => [String(row._id), row.total]),
  );

  return {
    docsUrl: softmatoDocsUrl(),
    invoices: invoices.map((invoice) => {
      const paid = paidByInvoice.get(String(invoice._id)) ?? 0;

      return {
        amount: invoice.amount,
        currency: invoice.currency ?? "NPR",
        cycleLabel: CYCLE_LABELS[invoice.cycle] ?? invoice.cycle,
        documentUrl: invoice.documentUrl ?? null,
        dueAt: invoice.dueAt?.toISOString() ?? null,
        invoiceNumber: invoice.invoiceNumber,
        issuedAt: invoice.issuedAt?.toISOString() ?? null,
        outstanding: Math.max(0, invoice.amount - paid),
        paid,
        planName: invoice.planName,
        softmatoInvoiceNo: invoice.softmatoInvoiceNo ?? null,
        status: invoice.status,
      };
    }),
    payments: payments.map((payment) => ({
      amount: payment.amount,
      documentUrl: payment.receiptDocumentUrl ?? null,
      method: payment.method,
      paidAt: payment.settledAt?.toISOString() ?? null,
      provider: payment.softmatoProvider ?? null,
      providerRef: payment.gatewayReference ?? null,
      receiptNumber: payment.receiptNumber ?? null,
      softmatoTransactionNo: payment.softmatoTransactionNo ?? null,
      status: payment.status,
    })),
  };
}

/**
 * One invoice in full, as Softmato has it.
 *
 * Scoped by hostel before a single field crosses the wire: the caller passes
 * the hostel they are authorised for, and an invoice belonging to another one
 * is answered `null` rather than fetched. Softmato would refuse an invoice
 * belonging to another *application*, but every hostel on this platform shares
 * one credential — so tenancy is ours to enforce, and this is where.
 */
export async function getInvoiceDetailForHostel(
  hostelId: string,
  invoiceNumber: string,
) {
  await connectToDatabase();

  const invoice = await SubscriptionInvoiceModel.findOne({
    hostelId: new Types.ObjectId(hostelId),
    invoiceNumber,
  }).lean<{ softmatoInvoiceNo?: string | null } | null>();

  if (!invoice?.softmatoInvoiceNo) return null;

  return fetchInvoiceDetail(invoice.softmatoInvoiceNo);
}
