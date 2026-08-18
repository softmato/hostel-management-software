/**
 * Whether a push may interrupt someone right now.
 *
 * Kept pure and free of database and network imports so the two decisions that
 * matter — the midnight wrap and the urgent override — can be tested directly
 * rather than through a mocked send path.
 */

export type PushPreference = {
  mutedCategories?: string[];
  pushEnabled?: boolean;
  quietHoursEnabled?: boolean;
  /** Minutes past local midnight, 0–1439. */
  quietHoursEnd?: number;
  /** Minutes past local midnight, 0–1439. */
  quietHoursStart?: number;
  timeZone?: string;
};

/**
 * Local wall-clock minutes past midnight, in an arbitrary IANA zone.
 *
 * `Intl.DateTimeFormat` rather than an offset arithmetic helper because Nepal is
 * **+05:45**. Any code that reasons in whole hours is 45 minutes wrong here, and
 * 45 minutes is the difference between "quiet hours ended" and "you woke me".
 *
 * An unknown zone throws inside `Intl`; that is caught and answered with UTC
 * rather than propagating, because a typo in a preference must not be able to
 * take down the notification pipeline for everyone in the batch.
 */
export function localMinutesNow(timeZone: string, now: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      timeZone,
    }).formatToParts(now);

    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

    // `en-GB` renders midnight as "24" in some ICU versions; fold it back.
    return ((hour % 24) * 60 + minute) % 1440;
  } catch {
    return (now.getUTCHours() * 60 + now.getUTCMinutes()) % 1440;
  }
}

/**
 * Is `minutes` inside the window `[start, end)`?
 *
 * The window **wraps midnight** in the ordinary case — 22:00 → 07:00 is
 * `start > end`, which is what most people set and what a naive
 * `start <= n && n < end` gets exactly backwards, silencing the whole day and
 * letting the night through.
 *
 * `start === end` is treated as *no* quiet hours rather than as 24 hours of
 * them. It is what a half-finished edit looks like, and the safe reading of an
 * ambiguous preference is the one that still delivers.
 */
export function isWithinQuietHours(
  minutes: number,
  start: number,
  end: number,
): boolean {
  if (start === end) {
    return false;
  }

  return start < end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

export type PushGateInput = {
  category?: string;
  /**
   * SOS and anything URGENT. Passed in rather than re-derived so this file and
   * `push.service.ts` cannot disagree about what counts as urgent.
   */
  isUrgent?: boolean;
  now?: Date;
  preference?: PushPreference | null;
};

export type PushGateResult = {
  allowed: boolean;
  /** Why it was blocked. Useful in tests and in a future delivery log. */
  reason: "MUTED_CATEGORY" | "OK" | "PUSH_DISABLED" | "QUIET_HOURS";
};

/**
 * The whole preference check, in one place.
 *
 * ## Urgent always goes through
 *
 * Quiet hours and the push master switch are both **overridden** by an urgent
 * notification. The urgent channel is SOS — someone's safety alert — and a
 * product that lets a preference screen silence that has built a setting whose
 * worst case is a person not being found. A muted *category* is overridden for
 * the same reason.
 *
 * This is the one asymmetry in the file and it is not a bug: everything else is
 * "respect what they asked for".
 *
 * ## No preference means yes
 *
 * An account that has never opened the settings screen has no row, and the
 * absence of an opinion is not an opinion. Reading `null` as "wants nothing"
 * would mute every existing user the moment this shipped.
 */
export function shouldPush({
  category,
  isUrgent = false,
  now = new Date(),
  preference,
}: PushGateInput): PushGateResult {
  if (isUrgent) {
    return { allowed: true, reason: "OK" };
  }

  if (!preference) {
    return { allowed: true, reason: "OK" };
  }

  if (preference.pushEnabled === false) {
    return { allowed: false, reason: "PUSH_DISABLED" };
  }

  if (category && preference.mutedCategories?.includes(category)) {
    return { allowed: false, reason: "MUTED_CATEGORY" };
  }

  if (preference.quietHoursEnabled) {
    const minutes = localMinutesNow(preference.timeZone || "Asia/Kathmandu", now);

    if (
      isWithinQuietHours(
        minutes,
        preference.quietHoursStart ?? 22 * 60,
        preference.quietHoursEnd ?? 7 * 60,
      )
    ) {
      return { allowed: false, reason: "QUIET_HOURS" };
    }
  }

  return { allowed: true, reason: "OK" };
}
