/**
 * One date, written in whichever calendar the hostel keeps its books in.
 *
 * ## Why this is a preference and not a second line of text
 *
 * `format.ts` already carries `formatDateBoth`, which prints `Bhadra 2, 2083 BS
 * · 18 Aug 2026`. That was the right answer for a screen where a date *is* money
 * — an invoice due date read by an owner in BS and a bank in AD — and it is the
 * wrong answer for the other forty places a date appears, where doubling every
 * one of them is two thirds of a list row spent saying the same thing twice.
 *
 * So the portal picks one. A hostel whose ledger is in Bikram Sambat sets it
 * once and every screen follows; one that thinks in Gregorian changes nothing.
 * The choice lives in `uiSlice.calendarPreference` and reaches screens through
 * `hooks/use-dates.ts` — this file is the pure half, so the conversion rules can
 * be tested without a store or a device.
 *
 * ## Nothing here changes what is sent
 *
 * Every function takes an instant (or the server's `2026-08` period key) and
 * returns a string to draw. No caller may parse one back: a BS date is display,
 * the ISO instant is the record, and a screen that round-trips through this
 * module has lost the timezone the whole of `format.ts` exists to pin down.
 *
 * ## Falling back is always to AD, never to a guess
 *
 * `nepali-date-converter`'s table does not run forever in either direction, and
 * `formatDateBs` / `formatPeriodBs` say so by handing back the Gregorian date
 * or an empty string. A confidently wrong Nepali due date is worse than an
 * honest English one, so every branch below prefers the fallback.
 */

import {
  formatAgo,
  formatDate,
  formatDateBs,
  formatDateTime,
  formatDayMonth,
  formatDayMonthBs,
  formatPeriod,
  formatPeriodBs,
  formatPeriodMonth,
  formatPeriodMonthBs,
  formatPeriodYear,
  formatPeriodYearBs,
  formatRelativeDay,
  formatTime,
  formatWeekday,
  formatYear,
  formatYearBs,
} from "@/lib/format";

export type CalendarSystem = "AD" | "BS";

/** What each option is called where the choice is offered. */
export const CALENDAR_LABELS: Record<CalendarSystem, string> = {
  AD: "English date",
  BS: "Nepali date",
};

/**
 * The example under each option, so the choice is made by looking.
 *
 * Today's date, never a frozen one. A literal `18 Aug 2026` sitting under
 * "English date" is a wrong date on every other day of the year, and the one
 * thing the calendar picker cannot afford to show is a wrong date — the reader
 * is there deciding which calendar to trust.
 */
export function calendarExample(
  calendar: CalendarSystem,
  now: Date = new Date(),
): string {
  return formatDateIn(calendar, now);
}

/** `18 Aug 2026`, or `Bhadra 2, 2083 BS`. */
export function formatDateIn(
  calendar: CalendarSystem,
  value: Date | string | null | undefined,
): string {
  return calendar === "BS" ? formatDateBs(value) : formatDate(value);
}

/**
 * A date with the weekday after it — `Bhadra 2, 2083 BS · Tuesday`.
 *
 * ## Why the weekday is not on every date
 *
 * It is the single most useful thing you can add to a date and the single
 * easiest thing to add to too many of them. "That Friday" is how a person
 * remembers the day they paid, or the night they were marked absent — but a
 * notification list where every row ends in a weekday has spent a third of each
 * row saying something nobody read.
 *
 * So it goes on dates that are the *subject* of what you are looking at — the
 * day an attendance row is about, the day a roll call covers, the heading over a
 * group of that day's meal photos — and nowhere else. A timestamp hanging off
 * the end of a row is not a subject.
 *
 * The weekday itself is calendar-independent: Bikram Sambat renumbers the days,
 * it does not reorder them, so `formatWeekday` answers for both. It reads the
 * Nepal-local day like everything else here, so a phone left on another timezone
 * still names the weekday the hostel is having.
 */
export function formatDateLongIn(
  calendar: CalendarSystem,
  value: Date | string | null | undefined,
): string {
  const date = formatDateIn(calendar, value);
  const weekday = formatWeekday(value);

  return date === "—" || weekday === "—" ? date : `${date} · ${weekday}`;
}

/**
 * `18 Aug 2026, 2:45 pm`, or `Bhadra 2, 2083 BS, 2:45 pm`.
 *
 * The clock half is untouched: Bikram Sambat is a calendar, not a timekeeping
 * system, and Nepal reads a 12-hour clock in both.
 */
export function formatDateTimeIn(
  calendar: CalendarSystem,
  value: Date | string | null | undefined,
): string {
  if (calendar !== "BS") {
    return formatDateTime(value);
  }

  const date = formatDateBs(value);

  return date === "—" ? date : `${date}, ${formatTime(value)}`;
}

/**
 * A month, named in the reader's calendar — `August 2026` or `Shrawan 2083 BS`.
 *
 * One month a side. The two calendars do not line up, so `2026-08` genuinely
 * straddles two Nepali months; the BS side names whichever of them holds more
 * of it, which is the same rounding a hostel makes when it calls this month's
 * rent Shrawan's rent. See `formatPeriodBs`.
 */
export function formatPeriodIn(
  calendar: CalendarSystem,
  period: string | null | undefined,
): string {
  if (calendar !== "BS") {
    return formatPeriod(period);
  }

  return formatPeriodBs(period) || formatPeriod(period);
}

/**
 * A day without its year — `16 Aug`, or `Aswin 15`.
 *
 * Only inside a section whose heading already names the year. See
 * {@link formatDayMonth}.
 */
export function formatDayMonthIn(
  calendar: CalendarSystem,
  value: Date | string | null | undefined,
): string {
  return calendar === "BS" ? formatDayMonthBs(value) : formatDayMonth(value);
}

/** A month without its year — `August`, or `Bhadra`. Same rule as above. */
export function formatPeriodMonthIn(
  calendar: CalendarSystem,
  period: string | null | undefined,
): string {
  if (calendar !== "BS") {
    return formatPeriodMonth(period);
  }

  return formatPeriodMonthBs(period) || formatPeriodMonth(period);
}

/**
 * The year a period falls in — `2026`, or `2083 BS`.
 *
 * The heading a grouped list of months sits under, and the thing that has to be
 * derived rather than sliced off the period key: `2026-09` is `2083 BS` and
 * `2026-02` is `2082 BS`, so a list grouped on the Gregorian year and then
 * labelled in Bikram Sambat puts two BS years under one heading. The Payments
 * screen shipped exactly that — a `2026` heading over rows that every one of
 * them said `2083 BS` — which is what `dueDate.slice(0, 4)` buys you.
 */
export function formatPeriodYearIn(
  calendar: CalendarSystem,
  period: string | null | undefined,
): string {
  if (calendar !== "BS") {
    return formatPeriodYear(period);
  }

  return formatPeriodYearBs(period) || formatPeriodYear(period);
}

/** The year an instant falls in — `2026`, or `2083 BS`. */
export function formatYearIn(
  calendar: CalendarSystem,
  value: Date | string | null | undefined,
): string {
  if (calendar !== "BS") {
    return formatYear(value);
  }

  return formatYearBs(value) || formatYear(value);
}

/**
 * `Today` / `Yesterday` / the date, in the reader's calendar.
 *
 * The two words in front are calendar-independent — a day is the same day in
 * both — so only the tail changes.
 */
export function formatRelativeDayIn(
  calendar: CalendarSystem,
  value: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  const relative = formatRelativeDay(value, now);

  if (calendar !== "BS" || relative === "—") {
    return relative;
  }

  return relative === "Today" || relative === "Yesterday"
    ? relative
    : formatDateBs(value);
}

/**
 * `2 hrs ago`, falling back to a date past a week — in the reader's calendar.
 *
 * The elapsed half never changes; an hour is an hour. What changes is the tail
 * `formatAgo` hands back once "days ago" stops being useful, which is a date and
 * therefore has a calendar.
 */
export function formatAgoIn(
  calendar: CalendarSystem,
  value: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  const elapsed = formatAgo(value, now);

  if (calendar !== "BS" || elapsed === "—") {
    return elapsed;
  }

  // Past a week `formatAgo` returns exactly `formatDate`. Comparing against it
  // is what distinguishes that branch from "6 days ago" without re-deriving the
  // threshold here and drifting from it.
  return elapsed === formatDate(value) ? formatDateBs(value) : elapsed;
}
