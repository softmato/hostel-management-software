/**
 * The month strip above the Payments tab.
 *
 * ## Why a strip rather than a picker
 *
 * The portal has a dropdown of periods because a mouse is good at dropdowns.
 * What an owner actually does on a phone is sweep back through the last few
 * months looking for the one that still has people in it, and a control that
 * hides every option until it is opened cannot show them *which* month that is.
 * The strip carries the answer on its face: one chip per month, each with the
 * count of invoices still unfinished on its shoulder.
 *
 * ## The number is `needsAttention`, not "unpaid"
 *
 * `needsAttention` is the server's own count of invoices in that period that
 * are not finished with — unpaid, partial, overdue and awaiting proof, all of
 * them. Recomputing it here from `total - paid` would produce a number that is
 * usually the same and occasionally not, in the one place a reader is entitled
 * to assume the badge and the list agree.
 *
 * A month with nothing waiting gets **no badge at all** rather than a zero: a
 * grey nought on eleven chips is eleven pieces of chrome saying nothing, and it
 * makes the two chips that do have work harder to find, not easier.
 *
 * ## Newest first, and it does not reorder
 *
 * `AdminPeriodSummary.months` arrives newest-first and gap-filled, so the chip
 * under the thumb when the screen opens is the current month and the past
 * scrolls away to the right. Sorting by "most waiting" was the obvious
 * alternative and is wrong: a strip whose chips move when a payment lands is a
 * strip nobody can build a habit on.
 */

import type { AdminPeriodRow } from "@/lib/admin-api";
import { MONTHS_SHORT, nepalPeriodKey, periodParts } from "@/lib/format";

export type PaymentMonth = {
  /** True for the month the phone is standing in — the chip that says "now". */
  isCurrent: boolean;
  /** `Aug`. The full both-calendar name goes under the strip, not on the chip. */
  label: string;
  /** `2026-08`, and the value the invoice matrix is fetched with. */
  period: string;
  /** Invoices still unfinished. Zero means no badge — see above. */
  waiting: number;
  /** `2026`. Its own line on the chip, because two Augusts are a real case. */
  year: string;
};

/**
 * The strip's chips, oldest month trimmed off the end.
 *
 * `limit` exists because the summary grows without bound — a hostel three years
 * old returns thirty-six rows, and the thirty-sixth is not a place anybody
 * scrolls to on a phone. Finance keeps the full history.
 */
export function paymentMonths(
  months: AdminPeriodRow[],
  { current, limit = 12 }: { current?: string; limit?: number } = {},
): PaymentMonth[] {
  const now = current ?? nepalPeriodKey();

  return months.slice(0, limit).flatMap((row) => {
    // `periodParts` is `format.ts`'s parser rather than a third copy of the
    // `YYYY-MM` regex. A row whose period it cannot read is dropped rather than
    // drawn as a chip labelled "—": that would be a tap target fetching a month
    // nobody can name.
    const parts = periodParts(row.period);

    if (!parts) {
      return [];
    }

    return [
      {
        isCurrent: row.period === now,
        label: MONTHS_SHORT[parts.monthIndex],
        period: row.period,
        waiting: Math.max(0, row.needsAttention ?? 0),
        year: String(parts.year),
      },
    ];
  });
}

/**
 * Which claims belong under a month.
 *
 * ## The one-off case is why this is a function
 *
 * A claim carries the `period` of the invoice it pays, and an **admission fee
 * has no period at all** — `Invoice.period` is null for a one-off by design.
 * Filtering on `claim.period === period` alone therefore hides the very first
 * claim a new resident ever files, in every month, with no screen anywhere that
 * lists it: the fee is not on any month's invoice matrix either.
 *
 * So a period-less claim surfaces on the **current** month, which is the month
 * somebody is standing in when they review it, and nowhere else — putting it on
 * every chip would count one claim eleven times.
 */
export function claimsForPeriod<T extends { period: string | null }>(
  claims: T[],
  period: string,
  { current }: { current?: string } = {},
): T[] {
  const now = current ?? nepalPeriodKey();

  return claims.filter(
    (claim) =>
      claim.period === period || (claim.period === null && period === now),
  );
}
