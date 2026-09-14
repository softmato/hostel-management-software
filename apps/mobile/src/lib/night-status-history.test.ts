import { describe, expect, it } from "vitest";

import {
  groupNightsByMonth,
  type NightHistoryEntry,
  nightDetail,
  summarizeNights,
} from "@/lib/night-status-history";

function entry(night: string, overrides: Partial<NightHistoryEntry> = {}): NightHistoryEntry {
  return {
    answeredAt: `${night}T15:00:00.000Z`,
    changes: 1,
    night,
    note: null,
    reasonCode: null,
    source: "RESIDENT",
    status: "INSIDE_HOSTEL",
    ...overrides,
  };
}

describe("groupNightsByMonth", () => {
  it("groups by AD month in the AD calendar", () => {
    const months = groupNightsByMonth(
      [entry("2026-09-02"), entry("2026-09-01"), entry("2026-08-31")],
      "AD",
    );

    expect(months.map((month) => [month.period, month.entries.length])).toEqual([
      ["2026-09", 2],
      ["2026-08", 1],
    ]);
  });

  it("groups by Bikram Sambat month in the BS calendar", () => {
    // 16 and 18 September 2026 straddle the Bhadra → Aswin boundary (Aswin 1 is
    // 17 September), which one AD month would have put under one heading.
    const months = groupNightsByMonth([entry("2026-09-18"), entry("2026-09-16")], "BS");

    expect(months).toHaveLength(2);
    expect(months[0].period).not.toBe(months[1].period);
  });
});

describe("summarizeNights", () => {
  it("counts in, out and unanswered", () => {
    expect(
      summarizeNights([
        entry("2026-09-03"),
        entry("2026-09-02", { status: "OUTSIDE_HOSTEL" }),
        entry("2026-09-01", { answeredAt: null, status: "NOT_VERIFIED" }),
      ]),
    ).toEqual({ inside: 1, outside: 1, total: 3, unanswered: 1 });
  });
});

describe("nightDetail", () => {
  it("says a night had no answer", () => {
    expect(nightDetail(entry("2026-09-01", { answeredAt: null, status: "NOT_VERIFIED" }))).toBe(
      "No answer",
    );
  });

  it("names the reason, the note and a staff correction", () => {
    expect(
      nightDetail(entry("2026-09-01", { reasonCode: "TRAVELLING", status: "OUTSIDE_HOSTEL" })),
    ).toBe("Travelling");
    expect(
      nightDetail(
        entry("2026-09-01", { note: "At cousins place", reasonCode: "OTHER", status: "OUTSIDE_HOSTEL" }),
      ),
    ).toBe("At cousins place");
    expect(nightDetail(entry("2026-09-01", { changes: 3, source: "WARDEN_OVERRIDE" }))).toBe(
      "Set by hostel staff · Changed 3 times",
    );
  });
});
