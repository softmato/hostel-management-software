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
import { nepalPeriodKey, periodParts } from "@/lib/format";
import { addBsMonths, bsMonthName } from "@hostel/calendar/bs";

export type PaymentMonth = {
  /** True for the month the phone is standing in — the chip that says "now". */
  isCurrent: boolean;
  /** `Aswin`. The full both-calendar name goes under the strip, not on the chip. */
  label: string;
  /** `2083-06`, and the value the invoice matrix is fetched with. */
  period: string;
  /** Invoices still unfinished. Zero means no badge — see above. */
  waiting: number;
  /** `2083`. Its own line on the chip, because two Aswins are a real case. */
  year: string;
};

/**
 * One chip's words, from a period key.
 *
 * ## The chip names the month the key actually is
 *
 * It used to read `MONTHS_SHORT[parts.monthIndex]`, and that dated from when a
 * period *was* a Gregorian month. It is a **Bikram Sambat** month now —
 * `periodParts` delegates to `bsPeriodParts` and returns BS parts — so the same
 * line labelled Aswin 2083 as `Jun`, a Gregorian month name over a Nepali year,
 * naming neither. The strip's own tests still carried `2026-08` fixtures from
 * before the migration, which is why nothing caught it.
 *
 * The caption under the strip is still the one that follows the reader's
 * calendar setting (`PaymentMonthStrip` renders `dates.period`). The chip has
 * room for a month and a year and is the *key's* own name; the line underneath
 * is where a conversion belongs.
 */
function chipOf(period: string, options: { current: string; waiting?: number }) {
  const parts = periodParts(period);

  // A period this cannot read is dropped by the callers rather than drawn as a
  // chip labelled "—": that would be a tap target fetching a month nobody can
  // name.
  if (!parts) {
    return null;
  }

  return {
    isCurrent: period === options.current,
    label: bsMonthName(parts.monthIndex + 1),
    period,
    waiting: Math.max(0, options.waiting ?? 0),
    year: String(parts.year),
  };
}

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
    const chip = chipOf(row.period, {
      current: now,
      waiting: row.needsAttention ?? 0,
    });

    return chip ? [chip] : [];
  });
}

/**
 * A strip of months around today, for choosing one the server has no row for.
 *
 * `paymentMonths` is built from the server's period roll-up, which only knows
 * months that have been **billed** — right for the Money tab, useless for
 * choosing a month to discount, which is usually this one or the next. So this
 * builds the window from the calendar instead, and hands back the same
 * `PaymentMonth` shape so both feed the same `<PaymentMonthStrip>`.
 *
 * **This month first, then forward, then back.** Not a descending run from a
 * year ahead: that put Aswin 2084 at the head of the strip during Aswin 2083 —
 * the same month name, thirteen chips from the one the reader meant — and a
 * discount set on "this month" silently landed a year away. The chip carries its
 * year for the same reason, and `isCurrent` lights the one that is now.
 *
 * `waiting` is zero throughout: the badge counts unfinished invoices, and this
 * builder has no invoice data. A month with nothing waiting gets no badge, so
 * the strip simply draws no counts — which is honest rather than empty, because
 * the question this strip asks is "which month", not "which needs me".
 */
export function monthWindow({
  back = 12,
  current,
  forward = 12,
}: { back?: number; current?: string; forward?: number } = {}): PaymentMonth[] {
  const now = current ?? nepalPeriodKey();

  const periods = [
    now,
    ...Array.from({ length: forward }, (_, index) => addBsMonths(now, index + 1)),
    ...Array.from({ length: back }, (_, index) => addBsMonths(now, -(index + 1))),
  ];

  return periods.flatMap((period) => {
    const chip = chipOf(period, { current: now });

    return chip ? [chip] : [];
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
