/**
 * Typed dates for the admin management screens.
 *
 * ## Why a text field and not a picker
 *
 * Every date these screens ask for — when a notice goes live, when it expires,
 * when a repair is booked, when a fee schedule starts — is a *day*, never a
 * moment, and it is almost always a day within the next fortnight. A native
 * date-picker wheel is three taps and a modal for something a person can type in
 * eight characters, and it drags in a platform dependency that behaves
 * differently on each OS. So the screens offer chips for the handful of answers
 * people actually give ("tomorrow", "in a week") and a `YYYY-MM-DD` field for
 * everything else, which is the pattern `id-card/edit.tsx` already uses.
 *
 * ## Days are local, instants are UTC
 *
 * The server takes `z.coerce.date()`, i.e. anything `new Date()` parses, and
 * stores an instant. Sending the bare `"2026-08-25"` would be parsed as
 * **midnight UTC**, which in Kathmandu (UTC+5:45) is 05:45 on the 25th — fine
 * for a start date and wrong for an expiry, where the notice would vanish at
 * quarter to six in the morning instead of at the end of the day.
 *
 * So parsing is explicit about which end of the day is meant: {@link startOfDayIso}
 * for "from this day", {@link endOfDayIso} for "until this day, inclusive".
 */

import { NEPAL_OFFSET_MINUTES } from "@/lib/format";

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` → the parts, or `null` when it is not a real day.
 *
 * Rejects `2026-02-31` rather than rolling it into March: a typo that silently
 * becomes a different date is worse than one that refuses to save.
 */
export function parseDayInput(value: string): { day: number; month: number; year: number } | null {
  const match = DAY_PATTERN.exec(value.trim());

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  // Round-trip through UTC to reject the impossible days of short months.
  const probe = new Date(Date.UTC(year, month - 1, day));

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { day, month, year };
}

function isoAt(value: string, minutesIntoDay: number): string | null {
  const parts = parseDayInput(value);

  if (!parts) {
    return null;
  }

  const utcMillis =
    Date.UTC(parts.year, parts.month - 1, parts.day) +
    (minutesIntoDay - NEPAL_OFFSET_MINUTES) * 60_000;

  return new Date(utcMillis).toISOString();
}

/** `2026-08-25` → the instant Nepal's 25th begins, as ISO. */
export function startOfDayIso(value: string): string | null {
  return isoAt(value, 0);
}

/** `2026-08-25` → 23:59 Nepal time on the 25th, so "until the 25th" includes it. */
export function endOfDayIso(value: string): string | null {
  return isoAt(value, 24 * 60 - 1);
}

/** An instant → the `YYYY-MM-DD` a Nepali reader would call it. */
export function toDayInput(value: Date | string | null | undefined): string {
  if (!value) {
    return "";
  }

  const date = typeof value === "string" ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const shifted = new Date(date.getTime() + NEPAL_OFFSET_MINUTES * 60_000);

  return shifted.toISOString().slice(0, 10);
}

/** Today in Kathmandu, plus `offsetDays`, as `YYYY-MM-DD`. */
export function dayInputFromNow(offsetDays = 0, now: Date = new Date()): string {
  return toDayInput(new Date(now.getTime() + offsetDays * 86_400_000));
}

/**
 * The first day of a month, `n` months from now, as a `YYYY-MM-DD` input value.
 *
 * Rates change on the first of a month and never mid-month, and a "next month"
 * chip that added thirty days is how an owner ended up with a card starting on
 * the 17th. `monthStartFromNow(1)` is the 1st of next month whatever today is —
 * not today plus a number of days.
 */
export function monthStartFromNow(offsetMonths = 0, now: Date = new Date()): string {
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);

  return toDayInput(start);
}

/** Whether an instant has already passed — how a screen tells live from expired. */
export function isPast(value: string | null | undefined, now: Date = new Date()): boolean {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  return !Number.isNaN(date.getTime()) && date.getTime() < now.getTime();
}

/** Whether an instant is still ahead — a notice scheduled but not yet published. */
export function isFuture(value: string | null | undefined, now: Date = new Date()): boolean {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  return !Number.isNaN(date.getTime()) && date.getTime() > now.getTime();
}
