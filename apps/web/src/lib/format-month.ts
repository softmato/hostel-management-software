/**
 * Human month formatting for the finance screens.
 *
 * The ledger's `period` is `YYYY-MM` because it sorts and compares as a string,
 * and every screen used to print it raw: a resident reading "2026-07" has to
 * decode their own rent statement, and a due date rendered by
 * `toLocaleDateString()` came out as "9/1/2026", which is September in one half
 * of the world and January in the other. Both are fixed here rather than in each
 * screen, so the two portals cannot drift into showing a month two different
 * ways.
 *
 * Locale is pinned to `en-GB` on purpose. These strings are read by residents
 * and hostel owners in Nepal, where day-month-year is the written convention —
 * leaving it to the browser would make the same invoice read differently for the
 * owner and the resident looking at it together.
 */

import { bsPeriodOf, formatBsPeriod } from "@hostel/shared/calendar/bs";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * `"2083-05"` → `"Bhadra 2083 BS"`. Anything unparseable comes back untouched.
 *
 * A period is a **Bikram Sambat** month now — the month the hostel's own books,
 * notice board and receipt pad all run on — so this names it directly rather
 * than indexing an English month table with it. Doing that would have printed
 * `2083-05` as "May 2083": the right two numbers, the wrong calendar, and 57
 * years out.
 *
 * A Gregorian key from before the migration keeps its English name, which is
 * what it has always meant. See `isBsPeriod` for why the two never collide.
 */
export function monthLabel(period: string | null | undefined): string {
  if (!period) {
    return "—";
  }

  const bs = formatBsPeriod(period);

  if (bs) {
    return bs;
  }

  const match = /^(\d{4})-(\d{2})$/.exec(period);

  if (!match) {
    return period;
  }

  const monthIndex = Number(match[2]) - 1;

  return MONTH_NAMES[monthIndex] ? `${MONTH_NAMES[monthIndex]} ${match[1]}` : period;
}

/**
 * `"2083-05"` → `"Bhadra 2083"`, for badges and cells that cannot take the era.
 *
 * The month name is not abbreviated. `Bhadra` and `Baisakh` both shorten to
 * `Bha`/`Bai` and `Mangsir`/`Magh` to `Man`/`Mag` — three letters do not
 * separate the Nepali months the way they separate the English ones, and a
 * badge nobody can read is worse than a badge two characters wider. What comes
 * off is the ` BS`, which the surrounding screen has already established.
 */
export function shortMonthLabel(period: string | null | undefined): string {
  const full = monthLabel(period);

  if (full.endsWith(" BS")) {
    return full.slice(0, -3);
  }

  return full === "—" || !full.includes(" ")
    ? full
    : `${full.slice(0, 3)} ${full.split(" ")[1]}`;
}

/** A date as `"1 Sep 2026"` — never the ambiguous `9/1/2026`. */
export function dayMonthYear(value: Date | string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** `"1 Sep 2026, 14:20"` — for timestamps where the time matters. */
export function dayMonthYearTime(value: Date | string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * How long they have — `"25 days left"`, `"Due today"`, `"3 days overdue"`.
 *
 * A date on its own is a fact the reader has to do arithmetic on, and "31 Aug"
 * tells a resident nothing about whether they need to act this week. Both
 * portals say it the same way because the resident and the owner discuss the
 * same invoice.
 *
 * Empty string, not `"—"`, when the date is unusable: this reads as a clause
 * appended to a due date, and a dash dangling after "Due 31 Aug" is worse than
 * saying nothing.
 */
export function daysLeftLabel(value: Date | string | null | undefined): string {
  if (!value) {
    return "";
  }

  const target = value instanceof Date ? new Date(value) : new Date(value);

  if (Number.isNaN(target.getTime())) {
    return "";
  }

  const start = new Date();

  // Both floored to local midnight: comparing timestamps would make an invoice
  // due at 00:00 tomorrow read as "0 days left" all of today.
  start.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  const days = Math.round((target.getTime() - start.getTime()) / 86_400_000);

  if (days < 0) {
    return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  }

  return days === 0 ? "Due today" : `${days} day${days === 1 ? "" : "s"} left`;
}

/**
 * `"2 hrs ago"`, `"5 days ago"` — how long a claim has been waiting (§11.4).
 *
 * An owner scanning a queue is asking "who has been waiting longest", and an
 * absolute timestamp makes them do the subtraction on every row. Coarse on
 * purpose: minutes matter for the top of the queue and stop mattering entirely
 * after a day, so nothing here pretends to more precision than the decision
 * needs. Falls back to the full date past a week, where "23 days ago" is less
 * useful than the date itself.
 */
export function timeAgo(value: Date | string | null | undefined): string {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);

  // A clock a few minutes ahead of ours must not render "in 3 minutes" on a
  // claim that has already arrived.
  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.round(hours / 24);

  return days <= 7 ? `${days} day${days === 1 ? "" : "s"} ago` : dayMonthYear(date);
}

/**
 * `"2083-05"` for a `Date`, matching the ledger's period key.
 *
 * **An identity, not a label.** Whatever this returns is compared against, and
 * sent as, a `period` the server keys invoices by — so it has to be the same
 * string `hostelPeriodOf` produces, character for character. Assembling a
 * Gregorian `2026-09` here after billing moved to Bikram Sambat would have asked
 * the server for a month it has no invoices in and drawn an empty screen with no
 * error on it, which is the quietest way this change could have broken.
 *
 * Delegated to the shared calendar for exactly that reason: there is one answer
 * to "which month is this" and it does not get a second implementation on the
 * client.
 */
export function periodKey(date: Date): string {
  return bsPeriodOf(date);
}

/**
 * Is this a complete `YYYY-MM` period?
 *
 * A `<input type="month">` being typed into rather than picked emits every
 * half-formed value on the way — `2026-0` among them — and a query keyed on the
 * raw value sent one 422 per keystroke. Callers use this to hold the query back
 * until the period is whole.
 */
export function isPeriod(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
