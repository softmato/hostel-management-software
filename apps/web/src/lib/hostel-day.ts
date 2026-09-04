/**
 * The calendar day a hostel is actually living in, as distinct from the instant.
 *
 * ## The bug this exists to end
 *
 * Move-in and move-out are **calendar dates**, not moments. Nobody moves in at
 * 18:15 UTC; they move in on the 3rd. But a date picker sends an instant — the
 * browser and the phone both serialise "3 September" as midnight in the user's
 * own zone, which in Nepal is `2026-09-02T18:15:00.000Z`. Every reader
 * downstream then works in UTC, so a resident who moved in on the 3rd was
 * billed from the **2nd**: 29 of 30 days instead of 28, on every intake, in the
 * one direction that overcharges.
 *
 * The same 5h45m turns the month boundary into a real fault rather than a rupee
 * or two. A resident admitted at midnight on 1 September lands on
 * `2026-08-31T18:15:00.000Z`, and `periodOfDate` — UTC like everything else —
 * puts their first invoice in **August**, prorated to a single day. The rate
 * card in force is looked up for the wrong month too.
 *
 * ## Why a fixed offset and not `Intl`
 *
 * Nepal is UTC+05:45 and has never observed daylight saving. A fixed offset is
 * therefore exact here, and it is arithmetic rather than a timezone database
 * lookup on the slowest write in the portal. The constant is named so that the
 * day the product leaves Nepal, the thing to change is findable.
 *
 * ## What "normalised" means
 *
 * A calendar day is stored as **UTC midnight of that day** — `2026-09-03T00:00Z`
 * for the 3rd. That is the shape `periodBounds` and `computeInvoiceAmount`
 * already assume (they count UTC days inclusively), so normalising at the edge
 * makes every existing reader correct without a second date vocabulary running
 * alongside the first.
 */

/** Asia/Kathmandu, which has never observed daylight saving. */
export const HOSTEL_UTC_OFFSET_MINUTES = 5 * 60 + 45;

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/**
 * The hostel-local calendar day an instant falls on, as UTC midnight.
 *
 * Idempotent on a value it has already produced *for any day at or after the
 * epoch*, which is what makes it safe to apply at the validation edge and again
 * in a service without shifting the date a second time: UTC midnight is 05:45
 * local, still the same day, so it maps back to itself.
 */
export function hostelCalendarDay(instant: Date): Date {
  const local = instant.getTime() + HOSTEL_UTC_OFFSET_MINUTES * MS_PER_MINUTE;

  return new Date(Math.floor(local / MS_PER_DAY) * MS_PER_DAY);
}

/** Today in the hostel's own reckoning, as UTC midnight. */
export function hostelToday(now: Date = new Date()): Date {
  return hostelCalendarDay(now);
}

/**
 * The first day of the hostel-local month an instant falls in, as UTC midnight.
 *
 * Rates change on the first of a month and never mid-month: a rate card that
 * starts on the 17th splits that month across two prices, which the billing run
 * refuses to do (`getEffectiveSchedule` gives a whole month to one card) and
 * which no resident can be shown a straight answer about. Normalising here means
 * a date picker's "next month" and a typed date land on the same day.
 */
export function hostelMonthStart(instant: Date): Date {
  const day = hostelCalendarDay(instant);

  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

/**
 * `2026-09` for the month a calendar day belongs to.
 *
 * Takes the *instant* and normalises it here rather than trusting the caller,
 * because the callers that get this wrong are exactly the ones passing
 * `new Date()` — and between 18:15 and 24:00 UTC on the last day of a month,
 * Nepal is already in the next one.
 */
export function hostelPeriodOf(instant: Date): string {
  const day = hostelCalendarDay(instant);

  return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}`;
}
