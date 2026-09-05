import { describe, expect, it } from "vitest";

import {
  isCurrentNight,
  isSelfReportable,
  NIGHT_STATUS_OPTIONS,
  nightNote,
  nightStanding,
} from "@/lib/night-status";
import type { NightStatus } from "@/lib/resident-api";

/**
 * Nepal is a fixed UTC+05:45, so every instant below is written in UTC with the
 * Kathmandu wall clock named next to it — the whole point of these cases is what
 * a resident's clock says, not what the server's does.
 */
const NIGHT_OF_17TH = {
  /** 17 Aug, 6:15 pm NPT. */
  evening: "2026-08-17T12:30:00.000Z",
  /** 18 Aug, 12:30 am NPT — same night as the evening above. */
  smallHours: "2026-08-17T18:45:00.000Z",
  /** 18 Aug, 9:15 am NPT — still that night's window (it ends at 5 pm). */
  morningAfter: "2026-08-18T03:30:00.000Z",
  /** 18 Aug, 6:15 pm NPT — a new night. */
  nextEvening: "2026-08-18T12:30:00.000Z",
};

function status(overrides: Partial<NightStatus> = {}): NightStatus {
  return {
    checkedAt: NIGHT_OF_17TH.evening,
    note: "",
    source: "RESIDENT",
    status: "INSIDE_HOSTEL",
    ...overrides,
  };
}

describe("NIGHT_STATUS_OPTIONS", () => {
  /*
   * The server's `nightStatusSchema` accepts all five values on the resident
   * route. Two of them must never be offered:
   *
   * `SOS_TRIGGERED` would write an emergency status with no `SOSAlert`, no
   * fan-out and nobody notified — an active alert on the warden's roster that
   * exists only as a word. `NOT_VERIFIED` is the absence of an answer, so
   * offering it lets someone "set" having set nothing.
   */
  it("offers only the three a resident can honestly report", () => {
    expect(NIGHT_STATUS_OPTIONS.map((option) => option.value)).toEqual([
      "INSIDE_HOSTEL",
      "OUTSIDE_HOSTEL",
      "MARKED_SAFE",
    ]);
  });

  it("refuses the two the server would accept but nothing would act on", () => {
    expect(isSelfReportable("SOS_TRIGGERED")).toBe(false);
    expect(isSelfReportable("NOT_VERIFIED")).toBe(false);
    expect(isSelfReportable("INSIDE_HOSTEL")).toBe(true);
  });
});

describe("isCurrentNight", () => {
  /*
   * The case a plain same-calendar-day check gets wrong. A resident who checked
   * in at 11pm must not be told at 00:30 that they have not checked in tonight.
   */
  it("keeps an evening and the small hours after it in the same night", () => {
    expect(
      isCurrentNight(NIGHT_OF_17TH.evening, new Date(NIGHT_OF_17TH.smallHours)),
    ).toBe(true);
  });

  it("still counts it the following morning, before the window rolls at 5pm", () => {
    expect(
      isCurrentNight(NIGHT_OF_17TH.evening, new Date(NIGHT_OF_17TH.morningAfter)),
    ).toBe(true);
  });

  it("expires it once the next night starts", () => {
    expect(
      isCurrentNight(NIGHT_OF_17TH.evening, new Date(NIGHT_OF_17TH.nextEvening)),
    ).toBe(false);
  });

  it("treats a missing or unparseable timestamp as unanswered", () => {
    expect(isCurrentNight(null)).toBe(false);
    expect(isCurrentNight(undefined)).toBe(false);
    expect(isCurrentNight("not a date")).toBe(false);
  });
});

describe("nightStanding", () => {
  it("reports tonight's answer back in the resident's own words", () => {
    const standing = nightStanding(
      status({ status: "OUTSIDE_HOSTEL" }),
      new Date(NIGHT_OF_17TH.smallHours),
    );

    expect(standing.answered).toBe(true);
    expect(standing.headline).toBe("Your hostel has you as out for the night tonight.");
    expect(standing.suggested).toBe("OUTSIDE_HOSTEL");
  });

  it("treats last night's answer as no answer", () => {
    const standing = nightStanding(status(), new Date(NIGHT_OF_17TH.nextEvening));

    expect(standing.answered).toBe(false);
    expect(standing.headline).toBe("Your hostel does not know where you are tonight.");
    // Nothing is preselected: a preselected stale answer is one tap away from
    // confirming a location the resident has not been asked about since.
    expect(standing.suggested).toBeNull();
  });

  it("treats a resident with no row at all as unanswered", () => {
    const standing = nightStanding(
      { checkedAt: null, note: "", source: "RESIDENT", status: "NOT_VERIFIED" },
      new Date(NIGHT_OF_17TH.evening),
    );

    expect(standing.answered).toBe(false);
    expect(standing.suggested).toBeNull();
  });

  /*
   * The one that must not read as routine. `triggerSOS` writes this status, and
   * `sosStatusUpdateSchema` is admin-only — so a resident marking themselves safe
   * changes the night status and leaves the alert `ACTIVE`. Saying otherwise is
   * how someone concludes they have called it off.
   */
  it("says an SOS is not retracted by changing a night status", () => {
    const standing = nightStanding(
      status({ status: "SOS_TRIGGERED" }),
      new Date(NIGHT_OF_17TH.smallHours),
    );

    expect(standing.sosNotice).toContain("only hostel staff");
    expect(standing.suggested).toBe("MARKED_SAFE");
    expect(standing.headline).toContain("SOS");
  });

  it("keeps the SOS notice even once the alert's night has passed", () => {
    const standing = nightStanding(
      status({ status: "SOS_TRIGGERED" }),
      new Date(NIGHT_OF_17TH.nextEvening),
    );

    expect(standing.sosNotice).toBeTruthy();
    expect(standing.answered).toBe(false);
  });

  /*
   * An SOS is not an answer to "where are you tonight". `checkedAt` on that row
   * is when the alert fired, so counting it as answered put "Checked in" on the
   * home card for a resident in the middle of an emergency.
   */
  it("never counts an SOS as tonight's answer", () => {
    const standing = nightStanding(
      status({ status: "SOS_TRIGGERED" }),
      new Date(NIGHT_OF_17TH.smallHours),
    );

    expect(standing.answered).toBe(false);
  });

  /*
   * The notice says only hostel staff can close the alert. Once they have, it
   * must go — and the night status row can never say so, because nothing
   * rewrites it.
   */
  it("drops the SOS notice once staff have settled the alert", () => {
    for (const sosStatus of ["RESOLVED", "FALSE_ALARM"]) {
      const standing = nightStanding(
        status({ status: "SOS_TRIGGERED" }),
        new Date(NIGHT_OF_17TH.smallHours),
        { createdAt: NIGHT_OF_17TH.evening, status: sosStatus },
      );

      expect(standing.sosNotice).toBeUndefined();
      expect(standing.headline).toBe("Your hostel does not know where you are tonight.");
    }
  });

  it("keeps it while the alert is only acknowledged", () => {
    const standing = nightStanding(
      status({ status: "SOS_TRIGGERED" }),
      new Date(NIGHT_OF_17TH.smallHours),
      { createdAt: NIGHT_OF_17TH.evening, status: "ACKNOWLEDGED" },
    );

    expect(standing.sosNotice).toBeTruthy();
  });
});

describe("nightNote", () => {
  it("omits an empty note rather than sending an empty string", () => {
    expect(nightNote("")).toEqual({});
    expect(nightNote("   ")).toEqual({});
  });

  // Unlike a complaint confirmation, `note` here has no minimum — so one
  // character is valid and must not be refused.
  it("accepts a one-character note, which this schema allows", () => {
    expect(nightNote("k")).toEqual({ note: "k" });
  });

  it("trims and keeps a real note", () => {
    expect(nightNote("  At my sister's in Lalitpur.  ")).toEqual({
      note: "At my sister's in Lalitpur.",
    });
  });

  it("rejects a note past the server's cap", () => {
    expect(nightNote("n".repeat(1001)).error).toBeTruthy();
  });
});
