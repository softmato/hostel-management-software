import { describe, expect, it } from "vitest";

import {
  isWithinQuietHours,
  localMinutesNow,
  shouldPush,
} from "@/modules/notifications/notification-quiet-hours";

const at = (hour: number, minute = 0) => hour * 60 + minute;

describe("isWithinQuietHours", () => {
  it("handles a window that wraps midnight — the ordinary case", () => {
    // 22:00 → 07:00 is what almost everyone sets, and it is `start > end`.
    // A naive `start <= n && n < end` gets this exactly backwards: silent all
    // day, and delivering at 3am.
    const start = at(22);
    const end = at(7);

    expect(isWithinQuietHours(at(23), start, end)).toBe(true);
    expect(isWithinQuietHours(at(3), start, end)).toBe(true);
    expect(isWithinQuietHours(at(6, 59), start, end)).toBe(true);
    expect(isWithinQuietHours(at(7), start, end)).toBe(false);
    expect(isWithinQuietHours(at(12), start, end)).toBe(false);
    expect(isWithinQuietHours(at(21, 59), start, end)).toBe(false);
  });

  it("handles a same-day window", () => {
    const start = at(13);
    const end = at(15);

    expect(isWithinQuietHours(at(14), start, end)).toBe(true);
    expect(isWithinQuietHours(at(13), start, end)).toBe(true);
    expect(isWithinQuietHours(at(15), start, end)).toBe(false);
    expect(isWithinQuietHours(at(9), start, end)).toBe(false);
  });

  it("treats an empty window as no quiet hours, not as all day", () => {
    // What a half-finished edit looks like. The safe reading of an ambiguous
    // preference is the one that still delivers.
    expect(isWithinQuietHours(at(3), at(22), at(22))).toBe(false);
  });
});

describe("localMinutesNow", () => {
  it("reads Nepal's +05:45 offset, not a whole-hour approximation", () => {
    // 18:00 UTC is 23:45 in Kathmandu. Any code reasoning in whole hours lands
    // on 23:00 — and 45 minutes is the difference between "quiet hours started"
    // and "you woke me".
    const utcEvening = new Date("2026-08-18T18:00:00Z");

    expect(localMinutesNow("Asia/Kathmandu", utcEvening)).toBe(at(23, 45));
  });

  it("folds midnight to 0 rather than 1440", () => {
    // 18:15 UTC is exactly 00:00 NPT the next day.
    expect(localMinutesNow("Asia/Kathmandu", new Date("2026-08-18T18:15:00Z"))).toBe(0);
  });

  it("falls back to UTC for a zone it cannot read", () => {
    // A typo in one account's preference must not throw inside a batch send and
    // take down delivery for everyone else in it.
    const noon = new Date("2026-08-18T12:34:00Z");

    expect(localMinutesNow("Not/AZone", noon)).toBe(at(12, 34));
  });
});

describe("shouldPush", () => {
  const night = new Date("2026-08-18T18:00:00Z"); // 23:45 in Kathmandu
  const quiet = {
    pushEnabled: true,
    quietHoursEnabled: true,
    quietHoursEnd: at(7),
    quietHoursStart: at(22),
    timeZone: "Asia/Kathmandu",
  };

  it("lets an urgent alert through quiet hours", () => {
    // The one asymmetry in the file, and not a bug: the urgent channel is SOS.
    // A settings screen that can silence a safety alert is a setting whose worst
    // case is a person not being found.
    expect(shouldPush({ isUrgent: true, now: night, preference: quiet })).toEqual({
      allowed: true,
      reason: "OK",
    });
  });

  it("lets an urgent alert through the master switch and a muted category", () => {
    expect(
      shouldPush({
        category: "SOS",
        isUrgent: true,
        now: night,
        preference: { mutedCategories: ["SOS"], pushEnabled: false },
      }),
    ).toEqual({ allowed: true, reason: "OK" });
  });

  it("holds an ordinary notification during quiet hours", () => {
    expect(shouldPush({ now: night, preference: quiet })).toEqual({
      allowed: false,
      reason: "QUIET_HOURS",
    });
  });

  it("delivers outside quiet hours", () => {
    const morning = new Date("2026-08-18T06:00:00Z"); // 11:45 NPT

    expect(shouldPush({ now: morning, preference: quiet })).toEqual({
      allowed: true,
      reason: "OK",
    });
  });

  it("respects the master switch", () => {
    expect(shouldPush({ preference: { pushEnabled: false } })).toEqual({
      allowed: false,
      reason: "PUSH_DISABLED",
    });
  });

  it("respects a muted category and ignores the ones not muted", () => {
    const preference = { mutedCategories: ["COMMUNITY"], pushEnabled: true };

    expect(shouldPush({ category: "COMMUNITY", preference })).toEqual({
      allowed: false,
      reason: "MUTED_CATEGORY",
    });
    expect(shouldPush({ category: "PAYMENT", preference })).toEqual({
      allowed: true,
      reason: "OK",
    });
  });

  it("delivers when the account has never set a preference", () => {
    // The absence of an opinion is not an opinion. Reading `null` as "wants
    // nothing" would mute every existing user the moment this shipped.
    expect(shouldPush({ preference: null })).toEqual({ allowed: true, reason: "OK" });
    expect(shouldPush({})).toEqual({ allowed: true, reason: "OK" });
  });
});
