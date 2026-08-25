/**
 * Who has not paid, in the order somebody should deal with them.
 *
 * Pure and free of the axios client, same rule as `lib/admin-alerts.ts`: Vitest
 * here runs node-side with no React Native shim, and this is the part of the
 * Money tab worth testing. The screen is a renderer over these functions.
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
 * The two views the Payments tab switches between.
 *
 * ## Why this is two and was four
 *
 * It was `owing | overdue | unbilled | settled`, drawn as a four-segment control
 * with a count on each. Three of those four counted the *same people twice*:
 * `owing` is every unsettled row and `overdue` and `unbilled` are both subsets
 * of it, so the control read `Owing 23 · Overdue 8 · Unbilled 3 · Paid 17` over
 * a roster of 40 — four numbers that cannot be added up, in the one place on the
 * screen where a reader is entitled to assume the tabs partition the list.
 *
 * Nesting is not something a segmented control can say. What the two subsets
 * were actually for survives without them: **overdue sorts to the top** of the
 * owing list (see `outstandingRows`), every row in that list carries its own
 * status pill, and the section header states both counts as a sentence. The
 * reader gets the same three facts without having to switch views to find them,
 * which is the point — a filter that hides the other twenty people is a worse
 * answer to "who do I chase" than a list that ranks them.
 *
 * `settled` stays because it answers a different question, not a narrower one:
 * "did so-and-so pay". It is deliberately not the default — a screen that opens
 * on the people who *have* paid is a screen that has forgotten what it is for.
 */
export type InvoiceSegment = "owing" | "settled";

/**
 * The rows a segment shows, always in `outstandingRows` order.
 *
 * `settled` sorts by name instead, since there is no outstanding amount to rank
 * those rows by and "did so-and-so pay" is a lookup, not a queue.
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

  return outstandingRows(rows);
}

/**
 * Every row that is not settled — late first, then most owed.
 *
 * ## Overdue leads, and that is the whole of what the Overdue tab did
 *
 * Sorting on the amount alone buried the people the hostel is actually losing
 * money on: a resident three weeks late for NPR 4,000 sat below four residents
 * who are merely unpaid for NPR 9,000 and not yet due. Late is a phone call
 * today and the others are a reminder next week, so late goes first and the
 * amount ranks within each block.
 *
 * Overdue is read from `displayStatus`, not from the due date. The server owns
 * the grace period, and comparing `dueDate` to `Date.now()` here would produce a
 * second, quieter definition that disagrees with the portal on the days either
 * side of the boundary.
 *
 * ## `NOT_BILLED` stays in
 *
 * The obvious filter is "rows with an unpaid invoice", and it hides the worst
 * case: a resident nobody billed at all. Nothing is chasing that, and nothing
 * will — no invoice means no due date, no dunning, no reminder. It sorts to the
 * bottom on amount (it owes nothing yet), which is why the screen also states
 * the count in the section header.
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
        Number(right.displayStatus === "OVERDUE") - Number(left.displayStatus === "OVERDUE") ||
        amountOwed(right) - amountOwed(left) ||
        left.resident.fullName.localeCompare(right.resident.fullName),
    );
}

/**
 * Free-text search over the invoice rows, client-side.
 *
 * Same argument as `searchResidents` on the roster tab: the matrix this screen
 * already holds is the hostel in full, so filtering what is in hand beats a
 * request per keystroke. Matches name, phone, room number and room type **as one
 * joined string**, so a first name and a room number typed together still find
 * the row, and an empty query returns everything rather than nothing — the field
 * starts empty and must not start by hiding the list.
 *
 * The amount is deliberately not searchable. `8500` would match the room number
 * of nobody and the phone number of somebody, which is the sort of coincidence
 * that makes a search field feel broken.
 */
export function searchInvoiceRows(
  rows: readonly AdminInvoiceRow[],
  query: string,
): AdminInvoiceRow[] {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return [...rows];
  }

  return rows.filter((row) =>
    [row.resident.fullName, row.resident.phone, row.resident.roomNumber, row.resident.roomType]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}
