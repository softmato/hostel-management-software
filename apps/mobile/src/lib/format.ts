/**
 * Money and dates, formatted once so no screen invents its own.
 *
 * ## Why not `Intl`
 *
 * Hermes ships an `Intl` implementation backed by the *platform's* ICU — the
 * OS's, not the bundle's — so `en-NP` grouping and `Asia/Kathmandu` resolve
 * differently on an Android 9 handset than on the simulator, and an
 * unrecognised locale silently degrades to `en-US`. Money on an invoice is not
 * a place for "usually right", so the grouping and the timezone shift are done
 * by hand here. They are pure functions, which is also what makes them
 * testable under the repo's node-environment Vitest setup.
 *
 * ## Nepal time
 *
 * NPT is a fixed UTC+05:45 with no daylight saving, so one constant offset is
 * the whole implementation. This matters more than it looks: a payment made at
 * 00:30 Kathmandu time is still *yesterday* in UTC, and a dashboard that says
 * "today's menu" while reading UTC days serves the wrong dinner for the last
 * 5 hours 45 minutes of every day.
 */

import NepaliDate from "nepali-date-converter";

const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTHS_LONG = [
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
] as const;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Thousands separators, three digits at a time.
 *
 * Deliberately *not* the lakh/crore grouping (`1,23,456`) some Nepali software
 * uses: every amount already rendered by `apps/web` is plain
 * `toLocaleString()`, and the two styles side by side on the same invoice —
 * one in the app, one in the emailed receipt — reads as a mismatch rather than
 * as a locale preference.
 */
function group(digits: string) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Renders paisa only when there are any.
 *
 * Rent is whole rupees, so `NPR 8,500.00` is noise on every row; a settlement
 * that genuinely lands on `1200.5` must not be shown as `1,200`, because a
 * balance that does not add up is the one thing a resident will call about.
 */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  const negative = value < 0;
  const absolute = Math.abs(value);
  const rounded = Math.round(absolute * 100) / 100;
  const whole = Math.floor(rounded);
  const paisa = Math.round((rounded - whole) * 100);
  const body =
    paisa === 0
      ? group(String(whole))
      : `${group(String(whole))}.${String(paisa).padStart(2, "0")}`;

  return negative ? `-${body}` : body;
}

/** `NPR 8,500`. The currency code, not `रु` — the web and the receipts say NPR. */
export function formatMoney(value: number | null | undefined): string {
  const amount = formatAmount(value);

  return amount === "—" ? amount : `NPR ${amount}`;
}

/**
 * The shape a hidden amount takes on the hostel hero.
 *
 * A fixed string, not the real figure with its digits swapped: `NPR 74,000`
 * masked character for character still prints `NPR XX,XXX`, which tells anyone
 * reading over the owner's shoulder the order of magnitude — the one thing the
 * eye toggle exists to withhold. `—` stays `—`, because the absence of a figure
 * is not a secret.
 */
export function maskMoney(value: string): string {
  return value === "—" ? value : "NPR XXX.xx";
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

type NepalParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  weekday: number;
  year: number;
};

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The calendar fields as they read on a wall clock in Kathmandu.
 *
 * Shifting the instant and then using the **UTC** getters is the trick: it
 * moves the clock without the device's own timezone getting a vote, so a phone
 * left on London time shows the same dates as one in Nepal.
 */
function nepalParts(date: Date): NepalParts {
  const shifted = new Date(date.getTime() + NEPAL_OFFSET_MINUTES * 60_000);

  return {
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    month: shifted.getUTCMonth(),
    weekday: shifted.getUTCDay(),
    year: shifted.getUTCFullYear(),
  };
}

/**
 * A day identity in Nepal time — the key "is this the same day" questions use.
 *
 * Exported so callers that need a *shifted* day — `lib/night-status.ts` asks
 * which night an instant belongs to, not which calendar day — can reuse the one
 * definition of the offset instead of restating `+05:45` and drifting from it.
 */
export function nepalDayKey(date: Date): string {
  const { day, month, year } = nepalParts(date);

  return `${year}-${month}-${day}`;
}

/**
 * The month an instant belongs to, in Nepal time — `2026-08`.
 *
 * The invoice period format, and the same offset as `nepalDayKey` rather than a
 * second copy of it. A phone left on UTC is an hour and a quarter behind
 * Kathmandu at worst, which matters for exactly two hours of the month — the
 * two where it would put an owner on the wrong month's chip on the first of the
 * month, the busiest rent day there is.
 */
export function nepalPeriodKey(date: Date = new Date()): string {
  const { month, year } = nepalParts(date);

  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** `16 Aug 2026`. */
export function formatDate(value: Date | string | null | undefined): string {
  const date = parseDate(value);

  if (!date) {
    return "—";
  }

  const { day, month, year } = nepalParts(date);

  return `${day} ${MONTHS_SHORT[month]} ${year}`;
}

/**
 * The same instant in Bikram Sambat — `2 Bhadra 2083`.
 *
 * ## Why both calendars, everywhere a date is money
 *
 * Decided 2026-08-17: **show both, side by side**, rather than choosing one.
 * Nobody in Nepal reads a rent due date in a single calendar — the hostel's
 * books run on BS and the bank's statement runs on AD — so a one-calendar date
 * makes somebody convert in their head at exactly the moment a mistake costs
 * money.
 *
 * ## The conversion is a dependency, deliberately
 *
 * BS month lengths **vary per year** and cannot be calculated; they are a
 * tabulated table of real data. Hand-copying ~30 years of it would be inventing
 * data that looks authoritative and is wrong in one cell nobody notices for a
 * year. `nepali-date-converter` (MIT) carries the table, and it was checked here
 * against five known New Year anchors — 2013-04-14, 2023-04-14, 2024-04-13,
 * 2025-04-14 and 2026-04-14 all land on Baisakh 1 — before being adopted.
 *
 * ## Nepal time first
 *
 * The conversion runs on the *Nepal* calendar day, not the device's. An invoice
 * due "1 Bhadra" must read the same on a phone left on another timezone, which
 * is the same reason `nepalParts` exists.
 */
export function formatDateBs(value: Date | string | null | undefined): string {
  const date = parseDate(value);

  if (!date) {
    return "—";
  }

  const { day, month, year } = nepalParts(date);

  try {
    // Constructed from the Nepal-local Y/M/D at noon, so no local-timezone
    // shift on the device can push it across a day boundary on the way in.
    const bs = new NepaliDate(new Date(Date.UTC(year, month, day, 12)));

    return bs.format("D MMMM YYYY");
  } catch {
    // The table does not cover every year for ever. A date outside it falls back
    // to Gregorian rather than showing a wrong Nepali date — being silently
    // wrong about a due date is the one outcome worth avoiding here.
    return formatDate(date);
  }
}

/**
 * Both calendars, BS first — `2 Bhadra 2083 · 18 Aug 2026`.
 *
 * BS leads because it is the one the hostel quotes; AD follows because it is the
 * one the bank and the phone agree on. Falls back to the Gregorian date alone
 * when the conversion is unavailable, never to a doubled or a wrong one.
 */
export function formatDateBoth(
  value: Date | string | null | undefined,
): string {
  const date = parseDate(value);

  if (!date) {
    return "—";
  }

  const ad = formatDate(date);
  const bs = formatDateBs(date);

  return bs === ad ? ad : `${bs} · ${ad}`;
}

/** `2:45 pm`. Lowercase meridiem — it sits next to a date, not alone. */
export function formatTime(value: Date | string | null | undefined): string {
  const date = parseDate(value);

  if (!date) {
    return "—";
  }

  const { hour, minute } = nepalParts(date);
  const meridiem = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;

  return `${twelve}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

/** `16 Aug 2026, 2:45 pm`. */
export function formatDateTime(
  value: Date | string | null | undefined,
): string {
  const date = parseDate(value);

  return date ? `${formatDate(date)}, ${formatTime(date)}` : "—";
}

/** `Sunday`. */
export function formatWeekday(value: Date | string | null | undefined): string {
  const date = parseDate(value);

  return date ? WEEKDAYS[nepalParts(date).weekday] : "—";
}

/**
 * `Today` / `Yesterday` / `16 Aug 2026`.
 *
 * For notice and claim timestamps, where the exact date matters far less than
 * whether the thing is new.
 */
export function formatRelativeDay(
  value: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  const date = parseDate(value);

  if (!date) {
    return "—";
  }

  if (nepalDayKey(date) === nepalDayKey(now)) {
    return "Today";
  }

  const yesterday = new Date(now.getTime() - 86_400_000);

  if (nepalDayKey(date) === nepalDayKey(yesterday)) {
    return "Yesterday";
  }

  return formatDate(date);
}

/** `"2026-08"` → `August 2026`. The invoice `month` field's format. */
export function formatPeriod(period: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period?.trim() ?? "");

  if (!match) {
    return period?.trim() || "—";
  }

  const monthIndex = Number(match[2]) - 1;

  return monthIndex >= 0 && monthIndex < 12
    ? `${MONTHS_LONG[monthIndex]} ${match[1]}`
    : (period as string);
}

/**
 * A period in Bikram Sambat — `Shrawan–Bhadra 2083`.
 *
 * ## A Gregorian month is not a Nepali month, and this says so
 *
 * The two calendars do not line up: BS months begin somewhere around the middle
 * of an AD one, so `2026-08` runs from the back half of Shrawan into the front
 * half of Bhadra. Naming it after either one alone would be wrong for roughly
 * half the days in it — and wrong in the direction that matters, because the
 * hostel's books are kept in BS and somebody reading "Bhadra" over a table of
 * August invoices will reconcile it against the wrong month's ledger.
 *
 * So it names both ends when there are two, and one when the period genuinely
 * sits inside a single BS month. The years collapse the same way: `Chaitra
 * 2082–Baisakh 2083` when the New Year falls inside the period, one year
 * otherwise.
 *
 * Returns `""` rather than a guess when the conversion table does not reach the
 * period — the caller drops the BS half of the label instead of printing a date
 * that is confidently wrong. Same rule as `formatDateBs`.
 */
export function formatPeriodBs(period: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period?.trim() ?? "");

  if (!match) {
    return "";
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;

  if (monthIndex < 0 || monthIndex > 11) {
    return "";
  }

  try {
    // Noon, like `formatDateBs`, so no timezone shift on the device can move
    // either end across a day boundary. Day 0 of the next month is the last day
    // of this one, whatever its length.
    const first = new NepaliDate(new Date(Date.UTC(year, monthIndex, 1, 12)));
    const last = new NepaliDate(
      new Date(Date.UTC(year, monthIndex + 1, 0, 12)),
    );

    const fromMonth = first.format("MMMM");
    const toMonth = last.format("MMMM");
    const fromYear = first.format("YYYY");
    const toYear = last.format("YYYY");

    if (fromMonth === toMonth && fromYear === toYear) {
      return `${fromMonth} ${fromYear}`;
    }

    return fromYear === toYear
      ? `${fromMonth}–${toMonth} ${toYear}`
      : `${fromMonth} ${fromYear}–${toMonth} ${toYear}`;
  } catch {
    return "";
  }
}

/**
 * Both calendars for a period — `August 2026 · Shrawan–Bhadra 2083`.
 *
 * The month-picker counterpart of `formatDateBoth`, and AD-first for the
 * opposite reason that one is BS-first: this label sits under a strip of
 * Gregorian month chips, so the calendar the reader just tapped leads.
 */
export function formatPeriodBoth(period: string | null | undefined): string {
  const ad = formatPeriod(period);
  const bs = formatPeriodBs(period);

  return bs ? `${ad} · ${bs}` : ad;
}

/**
 * How long ago, in the coarsest unit that is still true — `2 hrs ago`.
 *
 * For a queue of payment claims rather than for a date column. "Today" is the
 * honest answer to *when* a claim arrived and a useless answer to *how long a
 * resident has been waiting for their money*, which is the only reason this
 * queue is sorted the way it is. Hours are the resolution that question is
 * asked at.
 *
 * Falls back to `formatDate` past a week: "23 days ago" is arithmetic the reader
 * has to undo to get to a date, and by then the date is what they want.
 */
export function formatAgo(
  value: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  const date = parseDate(value);

  if (!date) {
    return "—";
  }

  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);

  // A clock skewed a few minutes into the future is common and "in 2 minutes"
  // on a claim that has already been submitted reads as a bug.
  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return minutes === 1 ? "1 min ago" : `${minutes} mins ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return hours === 1 ? "1 hr ago" : `${hours} hrs ago`;
  }

  const days = Math.floor(hours / 24);

  if (days <= 7) {
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }

  return formatDate(date);
}

/**
 * Days until a due date, in Nepal days — negative once it is overdue.
 *
 * Compared as whole days rather than as instants, so an invoice due "today"
 * reads as due today all day instead of flipping to overdue at noon.
 */
export function daysUntil(
  value: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  const date = parseDate(value);

  if (!date) {
    return null;
  }

  const startOfNepalDay = (input: Date) => {
    const { day, month, year } = nepalParts(input);

    return Date.UTC(year, month, day);
  };

  return Math.round(
    (startOfNepalDay(date) - startOfNepalDay(now)) / 86_400_000,
  );
}

/** `Due in 3 days` / `Due today` / `4 days overdue`. */
export function formatDueLabel(
  value: Date | string | null | undefined,
  now: Date = new Date(),
): string | null {
  const days = daysUntil(value, now);

  if (days === null) {
    return null;
  }

  if (days === 0) {
    return "Due today";
  }

  if (days > 0) {
    return days === 1 ? "Due tomorrow" : `Due in ${days} days`;
  }

  const overdue = Math.abs(days);

  return overdue === 1 ? "1 day overdue" : `${overdue} days overdue`;
}

/**
 * `Good morning` / `Good afternoon` / `Good evening`, on Kathmandu's clock.
 *
 * The device clock is the wrong one to ask: a resident whose phone is still on
 * roaming time gets greeted for the wrong half of the day on a screen that is
 * otherwise entirely about Nepali dates.
 */
export function greetingFor(now: Date = new Date()): string {
  const { hour } = nepalParts(now);

  if (hour < 12) {
    return "Good morning";
  }

  return hour < 17 ? "Good afternoon" : "Good evening";
}

/** `PENDING_PROOF` → `Pending proof`. Server enums are shouted; screens are not. */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const words = value
    .trim()
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "—";
  }

  return `${words[0].charAt(0).toUpperCase()}${words[0].slice(1)}${
    words.length > 1 ? ` ${words.slice(1).join(" ")}` : ""
  }`;
}
