/**
 * Who has not paid, in the order somebody should deal with them.
 *
 * Pure and free of the axios client, same rule as `lib/admin-alerts.ts`: Vitest
 * here runs node-side with no React Native shim, and this is the part of the
 * Money tab worth testing. The screen is a renderer over these two functions.
 */

import type { AdminInvoiceRow } from "@/lib/admin-api";

/**
 * What is still owed on a row.
 *
 * Zero for a resident with no invoice — `NOT_BILLED` means nothing has been
 * charged yet, so nothing is *owed* yet even though that row very much needs
 * attention. Clamped at zero because an overpayment (a resident who settled two
 * months in one transfer) would otherwise render as a negative debt.
 */
export function amountOwed(row: AdminInvoiceRow): number {
  const payment = row.payment;

  if (!payment) {
    return 0;
  }

  return Math.max(0, payment.dueAmount - payment.paidAmount);
}

/**
 * The four views the Money tab's segmented control switches between.
 *
 * `owing` is the default and the union of the two that follow it — somebody
 * opening this tab wants "who has not paid", not a taxonomy — while `overdue`
 * and `unbilled` are the two sub-cases worth isolating because they need
 * different actions: one is a phone call, the other is a billing run nobody has
 * done.
 */
export type InvoiceSegment = "owing" | "overdue" | "settled" | "unbilled";

/**
 * The rows a segment shows, always in `outstandingRows` order.
 *
 * ## `settled` is last and is not a queue
 *
 * It exists so the tab can answer "did so-and-so pay" without opening a laptop,
 * which is a real question and the only reason a paid row is worth rendering at
 * all. It is deliberately not the default: a screen that opens on the people who
 * *have* paid is a screen that has forgotten what it is for.
 *
 * ## Overdue is read from `displayStatus`, not from the due date
 *
 * The server decides overdue — it owns the grace period, and the invoice's own
 * `dueDate` says nothing about whether the hostel considers it late. Comparing
 * `dueDate` to `Date.now()` here would produce a second, quieter definition that
 * disagrees with the portal on the days either side of the boundary.
 */
export function invoiceSegment(
  rows: readonly AdminInvoiceRow[],
  segment: InvoiceSegment,
): AdminInvoiceRow[] {
  if (segment === "settled") {
    return rows
      .filter((row) => row.displayStatus === "PAID")
      .sort((left, right) => left.resident.fullName.localeCompare(right.resident.fullName));
  }

  const owing = outstandingRows(rows);

  if (segment === "overdue") {
    return owing.filter((row) => row.displayStatus === "OVERDUE");
  }

  if (segment === "unbilled") {
    return owing.filter((row) => row.displayStatus === "NOT_BILLED");
  }

  return owing;
}

/**
 * Every row that is not settled, most owed first.
 *
 * ## `NOT_BILLED` stays in
 *
 * The obvious filter is "rows with an unpaid invoice", and it hides the worst
 * case: a resident nobody billed at all. Nothing is chasing that, and nothing
 * will — no invoice means no due date, no dunning, no reminder. It sorts to the
 * bottom on amount (it owes nothing yet), which is why the screen also shows
 * the count as its own tile.
 *
 * ## Ties break on the name
 *
 * Several residents owing exactly one month's rent is the normal case, not an
 * edge case, so without a tiebreak the list reshuffles on every refresh and the
 * row somebody was reaching for moves under their thumb.
 */
export function outstandingRows(rows: readonly AdminInvoiceRow[]): AdminInvoiceRow[] {
  return rows
    .filter((row) => row.displayStatus !== "PAID")
    .sort(
      (left, right) =>
        amountOwed(right) - amountOwed(left) ||
        left.resident.fullName.localeCompare(right.resident.fullName),
    );
}
