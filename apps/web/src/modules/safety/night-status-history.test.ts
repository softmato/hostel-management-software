import { describe, expect, it } from "vitest";

import { nightHistory } from "@/modules/safety/night-status-history";

function log(night: string, time: string, nextStatus: string, extra: Record<string, unknown> = {}) {
  return {
    createdAt: new Date(`${night}T${time}:00.000+05:45`),
    night,
    nextStatus,
    source: "RESIDENT",
    ...extra,
  };
}

describe("nightHistory", () => {
  it("keeps the answer that stood at the end of each night", () => {
    const entries = nightHistory(
      [
        log("2026-09-14", "20:05", "OUTSIDE_HOSTEL", { note: "At a friend's", reasonCode: "OTHER" }),
        log("2026-09-14", "22:40", "INSIDE_HOSTEL"),
      ],
      "2026-09-14",
    );

    expect(entries).toEqual([
      expect.objectContaining({
        changes: 2,
        night: "2026-09-14",
        note: null,
        reasonCode: null,
        status: "INSIDE_HOSTEL",
      }),
    ]);
  });

  it("lists unanswered nights between the first record and tonight, newest first", () => {
    const entries = nightHistory(
      [log("2026-09-11", "20:10", "INSIDE_HOSTEL"), log("2026-09-13", "21:00", "OUTSIDE_HOSTEL")],
      "2026-09-14",
    );

    expect(entries.map((entry) => [entry.night, entry.status])).toEqual([
      ["2026-09-14", "NOT_VERIFIED"],
      ["2026-09-13", "OUTSIDE_HOSTEL"],
      ["2026-09-12", "NOT_VERIFIED"],
      ["2026-09-11", "INSIDE_HOSTEL"],
    ]);
    expect(entries[0].answeredAt).toBeNull();
  });

  it("places an old row without a night by its timestamp", () => {
    // 00:30 on the 12th belongs to the night of the 11th.
    const entries = nightHistory(
      [{ createdAt: new Date("2026-09-12T00:30:00.000+05:45"), nextStatus: "INSIDE_HOSTEL" }],
      "2026-09-11",
    );

    expect(entries[0]).toMatchObject({ night: "2026-09-11", status: "INSIDE_HOSTEL" });
  });

  it("is empty for a resident with no record at all", () => {
    expect(nightHistory([], "2026-09-14")).toEqual([]);
  });

  it("rolls back across a month boundary", () => {
    const entries = nightHistory([log("2026-08-31", "20:00", "INSIDE_HOSTEL")], "2026-09-01");

    expect(entries.map((entry) => entry.night)).toEqual(["2026-09-01", "2026-08-31"]);
  });
});
