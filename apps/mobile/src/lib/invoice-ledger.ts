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
