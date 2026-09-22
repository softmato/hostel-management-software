/**
 * Schedule math for superadmin pushes, kept pure so it is testable.
 *
 * Nepal has one fixed offset and no daylight saving, so a wall-clock date and
 * time converts to UTC by subtracting 5:45 — no time-zone database needed.
 */

export const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60_000;

export type PushRepeat = "ONCE" | "DAILY" | "WEEKLY";

export type PushTiming = {
  endsOn?: string | null;
  repeat: PushRepeat;
  startsOn: string;
  time: string;
  weekdays?: number[];
};

const DAY_MS = 86_400_000;

/** The UTC instant of a Nepal `YYYY-MM-DD` + `HH:mm`. */
export function nepalWallClockToUtc(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  return new Date(Date.UTC(year, month - 1, day, hour, minute) - NEPAL_OFFSET_MS);
}

/** The Nepal calendar date an instant falls on. */
export function nepalDateOf(instant: Date): string {
  return new Date(instant.getTime() + NEPAL_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The first occurrence strictly after `after`, or `null` when the schedule has
 * nothing left — a ONCE already past, a repeat beyond `endsOn`, a WEEKLY with
 * no days picked.
 *
 * Strictly after, so the dispatcher can pass the run it just claimed and get
 * the following one. A backlog is never replayed: a cron that was down for
 * three days sends the next occurrence, not three.
 */
export function nextOccurrence(timing: PushTiming, after: Date): Date | null {
  if (timing.repeat === "ONCE") {
    const at = nepalWallClockToUtc(timing.startsOn, timing.time);

    return at.getTime() > after.getTime() ? at : null;
  }

  const days = timing.repeat === "WEEKLY" ? (timing.weekdays ?? []) : null;

  if (days && days.length === 0) {
    return null;
  }

  const today = nepalDateOf(after);
  let date = timing.startsOn > today ? timing.startsOn : today;

  // Eight days covers any weekday set; the extra one is today's time already gone.
  for (let step = 0; step < 8; step += 1) {
    if (timing.endsOn && date > timing.endsOn) {
      return null;
    }

    const at = nepalWallClockToUtc(date, timing.time);

    if (at.getTime() > after.getTime() && (!days || days.includes(weekdayOf(date)))) {
      return at;
    }

    date = addDays(date, 1);
  }

  return null;
}

/**
 * From this many Nepal days before a bill's due day, its automatic reminder goes
 * out every morning and every evening until it is paid.
 */
export const DAILY_FROM_DAYS = 3;

/**
 * Whether an automatic run reminds about a bill `daysUntilDue` away — `0` on the
 * due day, negative once late. **Pure.**
 *
 * `earlyDays` are the single heads-ups before the daily stretch (a week and five
 * days out, on the morning run); from `DAILY_FROM_DAYS` on, every run reminds.
 */
export function remindsToday(daysUntilDue: number, earlyDays: readonly number[]) {
  return daysUntilDue <= DAILY_FROM_DAYS || earlyDays.includes(daysUntilDue);
}
