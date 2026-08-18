/**
 * Notification preferences — the types and the pure display logic.
 *
 * The two network calls live in `notification-preferences-api.ts`, deliberately:
 * anything that imports `lib/api` drags in `react-native`, whose Flow source the
 * node-only test runner cannot parse — so the logic worth testing is kept on
 * this side of that line. `vitest.config.mts` explains the rule.
 *
 * Typed off `NotificationPreference` in
 * `apps/web/src/modules/notifications/notification-preference.service.ts`.
 *
 * ## Times are minutes past local midnight
 *
 * Not `Date`s, not `"22:30"`. An integer 0–1439 compares in one operation and
 * survives every timezone conversion unchanged. `formatMinutes` / `parseMinutes`
 * below are the only places that turn one into a clock face, so the wire format
 * and the display format cannot drift apart.
 *
 * ## Quiet hours normally wrap midnight
 *
 * `start > end` is the ordinary case (22:00 → 07:00), not an error, and nothing
 * here should try to "fix" it by swapping them. The server owns the comparison.
 *
 * ## Urgent is not covered by any of this
 *
 * SOS and anything URGENT bypasses the master switch, muted categories and quiet
 * hours alike — server-side, in `shouldPush`. The screen says so, because a
 * person who believes they have silenced their phone and has not is worse off
 * than one who was never offered the switch.
 */

export type NotificationPreference = {
  mutedCategories: string[];
  pushEnabled: boolean;
  quietHoursEnabled: boolean;
  /** Minutes past local midnight, 0–1439. */
  quietHoursEnd: number;
  /** Minutes past local midnight, 0–1439. */
  quietHoursStart: number;
  timeZone: string;
};

/**
 * Categories a person can reasonably choose to mute, with the copy the screen
 * shows.
 *
 * A deliberately short list. Every string here has to match a `category` that
 * `publishNewNotification` actually sends, or the switch is decoration — so this
 * is the subset that is both real and safe to silence. **`SOS` is absent on
 * purpose**: it cannot be muted, and offering a switch that the server overrides
 * would be a lie told in a settings screen.
 */
export const MUTABLE_CATEGORIES: { description: string; label: string; value: string }[] = [
  {
    description: "Rent due, payment verified, receipts",
    label: "Payments",
    value: "PAYMENT",
  },
  { description: "Meal announcements from your cook", label: "Food", value: "FOOD" },
  { description: "Notices your hostel publishes", label: "Notices", value: "NOTICE" },
  {
    description: "Replies and status changes on what you raised",
    label: "Complaints",
    value: "COMPLAINT",
  },
  {
    description: "Replies, reactions and mentions",
    label: "Community",
    value: "COMMUNITY",
  },
];

/** `480` → `"08:00"`. */
export function formatMinutes(minutes: number): string {
  const safe = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** `"8:05"` → `485`, or `null` when it is not a time. */
export function parseMinutes(value: string): number | null {
  const match = /^\s*(\d{1,2})\s*:\s*(\d{2})\s*$/.exec(value);

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour > 23 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

/**
 * A plain-language summary of the current settings, for the row people read
 * before they decide whether to open anything.
 */
export function describePreference(preference: NotificationPreference): string {
  if (!preference.pushEnabled) {
    return "Push is off. Urgent safety alerts still come through.";
  }

  const muted = preference.mutedCategories.length;
  const parts: string[] = [];

  if (preference.quietHoursEnabled) {
    parts.push(
      `Quiet ${formatMinutes(preference.quietHoursStart)}–${formatMinutes(
        preference.quietHoursEnd,
      )}`,
    );
  }

  if (muted > 0) {
    parts.push(`${muted} ${muted === 1 ? "type" : "types"} muted`);
  }

  return parts.length > 0 ? parts.join(" · ") : "You get everything, at any hour";
}
