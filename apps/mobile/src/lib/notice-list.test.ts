import { describe, expect, it } from "vitest";

import type { ResidentNotice } from "@/lib/resident-api";
import {
  filterNotices,
  groupNoticesByDay,
  noticeCategories,
} from "@/lib/notice-list";

function notice(overrides: Partial<ResidentNotice> = {}): ResidentNotice {
  return {
    category: "GENERAL",
    content: "Body",
    id: "n-1",
    isRead: false,
    isUrgent: false,
    publishedAt: "2026-08-16T09:00:00.000Z",
    targetAudience: "ALL",
    title: "Notice",
    ...overrides,
  };
}

describe("noticeCategories", () => {
  it("lists only the categories present, sorted", () => {
    expect(
      noticeCategories([
        notice({ category: "MAINTENANCE" }),
        notice({ category: "EVENT" }),
        notice({ category: "MAINTENANCE" }),
      ]),
    ).toEqual(["EVENT", "MAINTENANCE"]);
  });
});

describe("filterNotices", () => {
  const rows = [
    notice({ category: "MAINTENANCE", id: "unread-maint" }),
    notice({ category: "MAINTENANCE", id: "read-maint", isRead: true }),
    notice({ category: "EVENT", id: "urgent-event", isUrgent: true }),
  ];

  it("returns everything when nothing is chosen", () => {
    expect(filterNotices(rows, "all")).toHaveLength(3);
  });

  it("composes status with category — the query the one-row control could not ask", () => {
    // The whole reason the filter was split in two: tapping a category used to
    // clear the status, so "unread maintenance" was unreachable.
    expect(filterNotices(rows, "unread", "MAINTENANCE").map((row) => row.id)).toEqual([
      "unread-maint",
    ]);
  });

  it("treats urgent and unread as independent", () => {
    // An urgent notice the resident has already read still belongs under
    // `Urgent`; folding the two together would hide the notice they most likely
    // want to re-read.
    const read = notice({ id: "urgent-read", isRead: true, isUrgent: true });

    expect(filterNotices([read], "urgent").map((row) => row.id)).toEqual(["urgent-read"]);
    expect(filterNotices([read], "unread")).toEqual([]);
  });

  it("keeps the list's own order", () => {
    expect(filterNotices(rows, "all").map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });
});

describe("groupNoticesByDay", () => {
  it("groups by the Kathmandu day, not the UTC one", () => {
    /*
      Both instants are 16 August in Kathmandu (UTC+05:45): 19:00Z is 00:45 on
      the 17th UTC-side of nothing, but 18:30Z is 00:15 on the 17th in Nepal.
      Picking two that straddle UTC midnight and not Nepal midnight is what
      makes this test about the timezone rather than about the grouping.
    */
    const days = groupNoticesByDay([
      notice({ id: "late", publishedAt: "2026-08-16T18:00:00.000Z" }),
      notice({ id: "morning", publishedAt: "2026-08-16T03:00:00.000Z" }),
    ]);

    expect(days).toHaveLength(1);
    expect(days[0].notices.map((row) => row.id)).toEqual(["late", "morning"]);
  });

  it("keeps the server's newest-first order across groups", () => {
    const days = groupNoticesByDay([
      notice({ id: "today", publishedAt: "2026-08-16T09:00:00.000Z" }),
      notice({ id: "older", publishedAt: "2026-08-14T09:00:00.000Z" }),
    ]);

    expect(days.map((day) => day.notices[0].id)).toEqual(["today", "older"]);
  });

  it("collects undated notices into one trailing group rather than dropping them", () => {
    const days = groupNoticesByDay([
      notice({ id: "dated" }),
      notice({ id: "undated-a", publishedAt: undefined }),
      notice({ id: "undated-b", publishedAt: undefined }),
    ]);

    expect(days).toHaveLength(2);
    expect(days[1].iso).toBeNull();
    expect(days[1].notices.map((row) => row.id)).toEqual(["undated-a", "undated-b"]);
  });

  it("does not treat an unparseable timestamp as a day of its own", () => {
    const days = groupNoticesByDay([notice({ id: "broken", publishedAt: "not a date" })]);

    expect(days[0].iso).toBeNull();
  });
});
