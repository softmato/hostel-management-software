/**
 * Timing for hostel push notices, pure so it is testable. The occurrence math
 * is the superadmin scheduler's — a push notice is that schedule with a
 * relative "later" and no end date.
 */

import {
  NEPAL_OFFSET_MS,
  nepalDateOf,
  nextOccurrence,
  type PushTiming,
} from "@/modules/notifications/platform-push-schedule";

export type NoticePushRepeat = "NOW" | "LATER" | "DAILY" | "WEEKLY";

export type NoticePushTiming = {
  repeat: NoticePushRepeat;
  startsOn?: string | null;
  time?: string | null;
  weekdays?: number[];
};

/** The Nepal date and minute `delayMinutes` from `now`, rounded up to the minute. */
export function laterFromDelay(now: Date, delayMinutes: number) {
  const at = new Date(Math.ceil((now.getTime() + delayMinutes * 60_000) / 60_000) * 60_000);
  const wall = new Date(at.getTime() + NEPAL_OFFSET_MS).toISOString();

  return { startsOn: nepalDateOf(at), time: wall.slice(11, 16) };
}

function asPushTiming(timing: NoticePushTiming, now: Date): PushTiming | null {
  if (timing.repeat === "NOW" || !timing.time) {
    return null;
  }

  return {
    repeat: timing.repeat === "LATER" ? "ONCE" : timing.repeat,
    startsOn: timing.startsOn || nepalDateOf(now),
    time: timing.time,
    weekdays: timing.weekdays ?? [],
  };
}

/** The next send strictly after `after`, or `null` for NOW or a LATER already gone. */
export function nextNoticePushRun(timing: NoticePushTiming, after: Date): Date | null {
  const push = asPushTiming(timing, after);

  return push ? nextOccurrence(push, after) : null;
}

/**
 * When a sent notice stops applying on the board: a repeat's copy expires as
 * the next one lands, so the board carries one current copy, not a stack of
 * last week's. A one-off never expires by itself, like any other notice.
 */
export function noticePushExpiry(timing: NoticePushTiming, sentAt: Date): Date | undefined {
  if (timing.repeat !== "DAILY" && timing.repeat !== "WEEKLY") {
    return undefined;
  }

  return nextNoticePushRun(timing, sentAt) ?? undefined;
}
