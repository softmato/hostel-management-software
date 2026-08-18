import type { ResidentInvoice } from "@/lib/finance-api";

/**
 * An invoice's money, as a statement that ties out.
 *
 * The resident's question on this screen is never "what is the status enum" —
 * it is "I paid NPR 4,000 last week, why does it still say I owe money". So the
 * detail view is a running balance: the charge, then every settled payment, and
 * what is left after each.
 *
 * ## The line that makes it honest
 *
 * `paidAmount` comes from the ledger — the sum of settled payment events.
 * `receipts` is a different set: receipts voided when their payment was
 * reversed are **excluded** by the server, so a resident cannot keep a document
 * asserting a payment the ledger no longer counts. The two therefore disagree
 * whenever a payment settled without a receipt issued yet, or a receipt was
 * voided.
 *
 * A statement built from receipts alone would end on a balance that does not
 * match the number in bold at the top of the same screen, which reads as a bug
 * in the hostel's accounting. So the difference is emitted as its own line
 * rather than absorbed silently: the rows always sum to `paidAmount`, and the
 * closing balance always equals the headline.
 */

export type LedgerLine = {
  /** Signed: the charge is positive, payments are negative. */
  amount: number;
  /** What is still owed after this line. */
  balance: number;
  date: string | null;
  kind: "charge" | "receipt" | "unreceipted";
  label: string;
};

export function invoiceLedger(invoice: ResidentInvoice): LedgerLine[] {
  const lines: LedgerLine[] = [];
  let balance = invoice.dueAmount;

  lines.push({
    amount: invoice.dueAmount,
    balance,
    date: invoice.dueDate ?? null,
    kind: "charge",
    label: "Amount billed",
  });

  // The server sorts receipts newest-first for the list view; a running balance
  // only reads correctly the other way round.
  const receipts = [...invoice.receipts].sort((a, b) => {
    const left = a.issuedAt ? Date.parse(a.issuedAt) : 0;
    const right = b.issuedAt ? Date.parse(b.issuedAt) : 0;

    return left - right;
  });

  let receipted = 0;

  for (const receipt of receipts) {
    balance -= receipt.amount;
    receipted += receipt.amount;

    lines.push({
      amount: -receipt.amount,
      balance,
      date: receipt.issuedAt,
      kind: "receipt",
      label: `Receipt ${receipt.number}`,
    });
  }

  // Rounded to paisa before comparing: floating-point subtraction on two equal
  // amounts can leave a 1e-13 residue, and a "NPR 0.00 settled elsewhere" row
  // is worse than the gap it explains.
  const unreceipted = Math.round((invoice.paidAmount - receipted) * 100) / 100;

  if (unreceipted > 0) {
    balance -= unreceipted;

    lines.push({
      amount: -unreceipted,
      balance,
      date: invoice.paidDate ?? null,
      kind: "unreceipted",
      label: "Settled, receipt pending",
    });
  }

  return lines;
}

/** What the headline shows: never negative, because an overpayment is credit. */
export function outstanding(invoice: ResidentInvoice): number {
  return Math.max(invoice.dueAmount - invoice.paidAmount, 0);
}

/**
 * Sums what is still owed across every invoice.
 *
 * Matches the server's own `buildFeeSummary`: only the statuses that still
 * represent an obligation count, and each is floored at zero so a month that
 * was overpaid cannot mask a month that was not.
 */
const OPEN_STATUSES = ["UNPAID", "PARTIAL", "OVERDUE", "PENDING_PROOF", "OPEN"];

export function totalOutstanding(invoices: ResidentInvoice[]): number {
  return invoices.reduce(
    (sum, invoice) =>
      OPEN_STATUSES.includes(invoice.status) ? sum + outstanding(invoice) : sum,
    0,
  );
}

/** Is this month still an obligation? The same list `totalOutstanding` sums. */
export function isOpenInvoice(invoice: ResidentInvoice): boolean {
  return OPEN_STATUSES.includes(invoice.status);
}

export type PaymentFilter = "all" | "open" | "settled";

export function filterInvoices(
  invoices: ResidentInvoice[],
  filter: PaymentFilter,
): ResidentInvoice[] {
  if (filter === "all") {
    return invoices;
  }

  return invoices.filter((invoice) =>
    filter === "open" ? isOpenInvoice(invoice) : !isOpenInvoice(invoice),
  );
}

export type PaymentStats = {
  /** The month the resident is actually here to deal with, or null. */
  nextDue: ResidentInvoice | null;
  /** The most recent month with money against it, for "you last paid…". */
  lastPaid: ResidentInvoice | null;
  overdueCount: number;
  settledCount: number;
};

/**
 * The four facts the payments screen leads with, ported from the web's `stats`.
 *
 * **`nextDue` is the earliest open month, not the newest.** The list arrives
 * newest-first, so taking the first open row would point a resident who is two
 * months behind at August while July quietly ages into a default. The one to
 * settle first is always the oldest debt.
 *
 * A missing `dueDate` sorts last rather than first: an invoice with no date is
 * not urgent, and treating absent as epoch-zero would put it above every real
 * one.
 */
export function paymentStats(invoices: ResidentInvoice[]): PaymentStats {
  const open = invoices.filter(isOpenInvoice);

  const nextDue =
    [...open].sort((left, right) => {
      const leftDue = left.dueDate ? Date.parse(left.dueDate) : Number.POSITIVE_INFINITY;
      const rightDue = right.dueDate ? Date.parse(right.dueDate) : Number.POSITIVE_INFINITY;

      return leftDue - rightDue;
    })[0] ?? null;

  const lastPaid =
    [...invoices]
      .filter((invoice) => invoice.paidAmount > 0)
      .sort((left, right) => {
        const leftPaid = left.paidDate ? Date.parse(left.paidDate) : 0;
        const rightPaid = right.paidDate ? Date.parse(right.paidDate) : 0;

        return rightPaid - leftPaid;
      })[0] ?? null;

  return {
    lastPaid,
    nextDue,
    overdueCount: invoices.filter((invoice) => invoice.status === "OVERDUE").length,
    settledCount: invoices.filter((invoice) => !isOpenInvoice(invoice)).length,
  };
}
