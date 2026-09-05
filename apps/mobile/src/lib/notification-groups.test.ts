import { describe, expect, it } from "vitest";

import { groupNotifications, notificationBucket } from "@/lib/notification-groups";

/**
 * Nepal is a fixed UTC+05:45, so every instant below is written in UTC with the
 * Kathmandu wall clock named next to it — the whole point of these cases is
 * which day the *hostel* was on, not which day the server was.
 */

/** 18 Aug 2026, 2:00 pm NPT. */
const NOW = new Date("2026-08-18T08:15:00.000Z");

/** 18 Aug, 12:15 am NPT — the same Nepal day as NOW, the day before in UTC. */
const EARLY_TODAY = "2026-08-17T18:30:00.000Z";

/** 17 Aug, 11:45 pm NPT — yesterday in Nepal, and still the 17th in UTC. */
const LATE_YESTERDAY = "2026-08-17T18:00:00.000Z";

/** 14 Aug, 2:00 pm NPT — four days back, inside the week. */
const THIS_WEEK = "2026-08-14T08:15:00.000Z";

/** 8 Aug, 2:00 pm NPT — ten days back. */
const EARLIER = "2026-08-08T08:15:00.000Z";

describe("notificationBucket", () => {
  it("files an instant by the Nepal day, not the phone's", () => {
    /*
     * The case this offset exists for. Both timestamps are 17 Aug in UTC and
     * half an hour apart; in Kathmandu one is just after midnight on the 18th
     * and the other is just before it. A `getDate()` comparison files both
     * under Yesterday, and a resident reading a 12:15am reminder would find it
     * under the wrong heading for the whole of the next day.
     */
    expect(notificationBucket(EARLY_TODAY, NOW)).toBe("today");
    expect(notificationBucket(LATE_YESTERDAY, NOW)).toBe("yesterday");
  });

  it("reaches back six days for this week and no further", () => {
    expect(notificationBucket(THIS_WEEK, NOW)).toBe("this-week");
    // 12 Aug, 2:00 pm NPT — six days back, the last day still in the week.
    expect(notificationBucket("2026-08-12T08:15:00.000Z", NOW)).toBe("this-week");
    // 11 Aug — seven days back, the first day out of it.
    expect(notificationBucket("2026-08-11T08:15:00.000Z", NOW)).toBe("earlier");
    expect(notificationBucket(EARLIER, NOW)).toBe("earlier");
  });

  it("puts a row stamped in the future at the top rather than the bottom", () => {
    // A clock a few minutes fast is common, and the newest row in the feed
    // filing itself under the oldest heading is the worst place for it.
    expect(notificationBucket("2026-08-18T09:00:00.000Z", NOW)).toBe("today");
  });

  it("keeps a row whose timestamp is missing or unusable", () => {
    expect(notificationBucket(undefined, NOW)).toBe("earlier");
    expect(notificationBucket("", NOW)).toBe("earlier");
    expect(notificationBucket("not a date", NOW)).toBe("earlier");
  });
});

describe("groupNotifications", () => {
  it("returns the headings newest first and drops the empty ones", () => {
    const groups = groupNotifications(
      [{ createdAt: EARLY_TODAY }, { createdAt: EARLIER }],
      NOW,
    );

    // No "Yesterday" over a gap: nothing arrived yesterday.
    expect(groups.map((group) => group.label)).toEqual(["Today", "Earlier"]);
  });

  it("keeps the server's order inside a group", () => {
    /*
     * `createOrUpdateBatchedNotification` bumps a row's `createdAt` to bring
     * "5 people reacted" back to the top of the feed, so re-sorting here would
     * move a row the reader is being pointed at.
     */
    const groups = groupNotifications(
      [
        { createdAt: "2026-08-18T08:00:00.000Z", id: "newest" },
        { createdAt: "2026-08-18T04:00:00.000Z", id: "older" },
        { createdAt: "2026-08-18T01:00:00.000Z", id: "oldest" },
      ],
      NOW,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((row) => row.id)).toEqual(["newest", "older", "oldest"]);
  });

  it("gives every bucket its heading", () => {
    const groups = groupNotifications(
      [
        { createdAt: EARLY_TODAY },
        { createdAt: LATE_YESTERDAY },
        { createdAt: THIS_WEEK },
        { createdAt: EARLIER },
      ],
      NOW,
    );

    expect(groups.map((group) => group.label)).toEqual([
      "Today",
      "Yesterday",
      "This week",
      "Earlier",
    ]);
    expect(groups.map((group) => group.bucket)).toEqual([
      "today",
      "yesterday",
      "this-week",
      "earlier",
    ]);
  });

  it("is empty for an empty feed", () => {
    expect(groupNotifications([], NOW)).toEqual([]);
  });
});
