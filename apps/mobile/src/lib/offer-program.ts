/**
 * The Resident Offer Program, as three questions asked of the payments payload.
 *
 * *Which code is live for me right now*, *what has the programme certified*, and
 * *what is still being checked*. All three are rearrangements of what
 * `getFinanceView()` already returns — there is no offer-program endpoint, and
 * a second one would be a second chance for two screens to disagree about the
 * same resident's money.
 *
 * Pure and node-testable, per the split every `*-api.ts` pair in this folder
 * follows.
 *
 * ## The open-status list is `invoice-ledger.ts`'s, not the web page's
 *
 * `resident-offer-program-page.tsx` filters active codes with its own
 * `OPEN_STATUSES = ["OPEN", "PARTIAL", "OVERDUE"]`, which **omits `UNPAID` and
 * `PENDING_PROOF`** — two statuses the server genuinely emits, `UNPAID` being
 * the ordinary state of a month nobody has paid yet. So the web hides the
 * reference code for exactly the invoice a resident is most likely to be about
 * to pay. Reproducing that would be reproducing a bug; `isOpenInvoice` holds the
 * same five statuses the server's own `buildFeeSummary` sums, in one place.
 */

import type { ResidentFinanceView, ResidentInvoice } from "@/lib/finance-api";
import { isOpenInvoice, outstanding } from "@/lib/invoice-ledger";

/**
 * Months whose code is still worth quoting — still owing, and carrying a code.
 *
 * Order is the payload's, which is newest-first from the server. Deliberately
 * not re-sorted by due date: the screen shows at most a handful, and a resident
 * who has fallen two months behind should see both in the order the payments
 * tab shows them rather than in a second arrangement of the same facts.
 */
export function activeCodes(invoices: ResidentInvoice[]): ResidentInvoice[] {
  return invoices.filter(
    (invoice) => Boolean(invoice.referenceCode) && isOpenInvoice(invoice),
  );
}

export type CertifiedReceipt = {
  amount: number;
  id: string;
  issuedAt: string | null;
  /** `YYYY-MM`, or `null` for an invoice belonging to no month. */
  month: string | null;
  number: string;
};

/**
 * Every receipt the programme has issued, newest first.
 *
 * **One receipt per payment, not per month** — a month somebody part-paid has
 * several, which is why the number rather than the month is the identifier on
 * screen.
 *
 * A receipt with no `issuedAt` sorts last rather than first. The web's
 * comparator coerces a missing date to `""`, which sorts it *above* every real
 * date; an undated receipt is almost always a migrated one, so putting it at the
 * top pushes this month's genuine receipt off the first screenful.
 */
export function certifiedReceipts(invoices: ResidentInvoice[]): CertifiedReceipt[] {
  return invoices
    .flatMap((invoice) =>
      invoice.receipts.map((receipt) => ({ ...receipt, month: invoice.month })),
    )
    .sort((left, right) => {
      if (!left.issuedAt && !right.issuedAt) {
        return 0;
      }

      if (!left.issuedAt) {
        return 1;
      }

      if (!right.issuedAt) {
        return -1;
      }

      return right.issuedAt.localeCompare(left.issuedAt);
    });
}

export type OfferProgramStats = {
  /** Total value of every certified receipt. */
  certifiedAmount: number;
  certifiedCount: number;
  /** Proofs the hostel has not decided on yet. */
  pendingCount: number;
};

export function offerProgramStats(view: ResidentFinanceView): OfferProgramStats {
  const receipts = certifiedReceipts(view.invoices);

  return {
    certifiedAmount: receipts.reduce((sum, receipt) => sum + receipt.amount, 0),
    certifiedCount: receipts.length,
    pendingCount: view.claims.filter((claim) => claim.status === "PENDING").length,
  };
}

/** What is still owed on a month whose code is being quoted. */
export function outstandingOn(invoice: ResidentInvoice): number {
  return outstanding(invoice);
}
