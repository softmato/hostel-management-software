import { describe, expect, it } from "vitest";

import {
  laterFromDelay,
  nextNoticePushRun,
  noticePushExpiry,
} from "@/modules/notices/notice-push-timing";

// 2026-09-15 is a Tuesday; 06:15:30Z is 12:00:30 in Kathmandu.
const TUESDAY_NOON = new Date("2026-09-15T06:15:30Z");
const WASHING = { repeat: "WEEKLY" as const, time: "18:00", weekdays: [0, 3] };

describe("notice push timing", () => {
  it("turns a delay into a Nepal date and minute, rounded up", () => {
    expect(laterFromDelay(TUESDAY_NOON, 30)).toEqual({ startsOn: "2026-09-15", time: "12:31" });
  });

  it("never schedules a NOW", () => {
    expect(nextNoticePushRun({ repeat: "NOW" }, TUESDAY_NOON)).toBeNull();
  });

  it("sends a weekly on its next picked day", () => {
    expect(nextNoticePushRun(WASHING, TUESDAY_NOON)?.toISOString()).toBe(
      "2026-09-16T12:15:00.000Z",
    );
  });

  it("expires a repeat's copy when the next one lands, and a one-off never", () => {
    const sentAt = new Date("2026-09-16T12:15:00Z");

    expect(noticePushExpiry(WASHING, sentAt)?.toISOString()).toBe("2026-09-20T12:15:00.000Z");
    expect(
      noticePushExpiry({ repeat: "LATER", startsOn: "2026-09-16", time: "18:00" }, sentAt),
    ).toBeUndefined();
  });
});
