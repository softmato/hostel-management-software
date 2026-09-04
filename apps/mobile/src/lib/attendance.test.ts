import { describe, expect, it } from "vitest";

import {
  type AttendanceDay,
  type AttendanceZone,
  groupByMonth,
  sourceNote,
  summarize,
  zoneDescription,
  zoneLabel,
  zoneTone,
} from "@/lib/attendance";

function day(date: string, zone: AttendanceZone = "INSIDE"): AttendanceDay {
  return { day: date, source: "MOBILE_PING", zone };
}

describe("the tone of a zone", () => {
  /*
   * `docs/DESIGN.md`: "'Outside Hostel' is a **neutral** status, not a warning —
   * students leaving the hostel is normal life, not a red flag. Only 'SOS' gets
   * urgent red treatment." This suite is that rule, enforced.
   */
  it("never treats being away as a warning", () => {
    expect(zoneTone("OUTSIDE")).toBe("neutral");
    expect(zoneTone("NEARBY")).toBe("neutral");
  });

  it("has no danger tone at all", () => {
    const zones: AttendanceZone[] = ["INSIDE", "NEARBY", "OUTSIDE", "UNKNOWN"];

    for (const zone of zones) {
      expect(zoneTone(zone)).not.toBe("danger");
    }
  });

  it("does not frame being inside as a success", () => {
    // `success` would make being out read as a failure, which is the
    // surveillance framing the design rules out.
    expect(zoneTone("INSIDE")).toBe("brand");
  });

  it("gives UNKNOWN the only weighted tone, because it means nothing is known", () => {
    expect(zoneTone("UNKNOWN")).toBe("warning");
  });
});

describe("what the labels claim", () => {
  it("says phone, not person, wherever it makes a claim about location", () => {
    // A resident who leaves their handset on the bed is recorded as present.
    // The wording must not assert more than the reading supports.
    for (const zone of ["INSIDE", "NEARBY", "OUTSIDE"] as AttendanceZone[]) {
      expect(zoneDescription(zone)).toContain("phone");
    }
  });

  it("explains UNKNOWN rather than leaving it to be guessed at", () => {
    const text = zoneDescription("UNKNOWN");

    expect(text).toContain("off");
    expect(zoneLabel("UNKNOWN")).toBe("Not recorded");
  });

  it("marks a warden's correction and stays quiet about an ordinary ping", () => {
    expect(sourceNote("MANUAL_OVERRIDE")).toBe("Set by your hostel");
    expect(sourceNote("MOBILE_PING")).toBeNull();
  });
});

describe("grouping for the screen", () => {
  it("groups by month, keeping the server's order inside each", () => {
    const months = groupByMonth([
      day("2026-09-03"),
      day("2026-09-01"),
      day("2026-08-30"),
    ]);

    expect(months.map((month) => month.period)).toEqual(["2026-09", "2026-08"]);
    expect(months[0].days.map((entry) => entry.day)).toEqual([
      "2026-09-03",
      "2026-09-01",
    ]);
  });

  it("does not re-sort — a second ordering is a second chance to disagree", () => {
    // Deliberately out of order. The payload is the authority.
    const months = groupByMonth([day("2026-09-01"), day("2026-09-03")]);

    expect(months[0].days.map((entry) => entry.day)).toEqual([
      "2026-09-01",
      "2026-09-03",
    ]);
  });

  it("starts a new group when the month repeats after a gap", () => {
    // Non-contiguous months must not be merged back together.
    const months = groupByMonth([day("2026-09-03"), day("2026-08-30"), day("2026-09-01")]);

    expect(months.map((month) => month.period)).toEqual([
      "2026-09",
      "2026-08",
      "2026-09",
    ]);
  });

  it("is empty for a resident with no readings", () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

describe("the summary", () => {
  it("counts days at the hostel against days actually recorded", () => {
    expect(
      summarize([
        day("2026-09-03", "INSIDE"),
        day("2026-09-02", "OUTSIDE"),
        day("2026-09-01", "INSIDE"),
      ]),
    ).toEqual({ inside: 2, recorded: 3 });
  });

  it("excludes UNKNOWN from the denominator", () => {
    // A day nothing was recorded is not a day the resident was absent, so it
    // cannot be counted against them.
    expect(
      summarize([day("2026-09-03", "INSIDE"), day("2026-09-02", "UNKNOWN")]),
    ).toEqual({ inside: 1, recorded: 1 });
  });

  it("is all zeroes when nothing was ever recorded", () => {
    expect(summarize([day("2026-09-02", "UNKNOWN")])).toEqual({
      inside: 0,
      recorded: 0,
    });
  });
});
