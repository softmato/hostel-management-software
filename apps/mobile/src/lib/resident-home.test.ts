import { describe, expect, it } from "vitest";

import { duesLine, stayPill } from "@/lib/resident-home";
import type { NightStatus } from "@/lib/resident-api";

const night = (over: Partial<NightStatus> = {}): NightStatus => ({
  checkedAt: null,
  note: "",
  source: "SELF",
  status: "NOT_VERIFIED",
  ...over,
});

describe("duesLine", () => {
  it("says a claim is in review before it says anything about the amount", () => {
    /*
      The case this ordering exists for: the resident has paid and uploaded the
      receipt, so `dueAmount` has not moved and the invoice is genuinely overdue
      — but telling them that is telling them to pay twice.
    */
    expect(
      duesLine({
        dueAmount: 8500,
        dueLabel: "4 days overdue",
        pendingProofs: 1,
        periodLabel: "Bhadra 2082",
        unpaidCount: 1,
      }),
    ).toBe("1 payment claim in review");

    expect(
      duesLine({
        dueAmount: 0,
        dueLabel: null,
        pendingProofs: 2,
        periodLabel: null,
        unpaidCount: 0,
      }),
    ).toBe("2 payment claims in review");
  });

  it("says nothing is outstanding when nothing is", () => {
    expect(
      duesLine({
        dueAmount: 0,
        dueLabel: "Due in 6 days",
        pendingProofs: 0,
        periodLabel: "Bhadra 2082",
        unpaidCount: 0,
      }),
    ).toBe("Nothing outstanding");
  });

  it("says whose date it is once more than one invoice is unpaid", () => {
    /*
      The count covers both invoices and the date covers only the earliest, so
      the line has to say so — otherwise a resident whose older invoice is a
      month overdue reads the newer one's date as covering the lot.
    */
    expect(
      duesLine({
        dueAmount: 17000,
        dueLabel: "11 days overdue",
        pendingProofs: 0,
        periodLabel: "Bhadra 2082",
        unpaidCount: 2,
      }),
    ).toBe("Oldest of 2 unpaid · 11 days overdue");
  });

  it("drops the date clause rather than the count when there is no due date", () => {
    expect(
      duesLine({
        dueAmount: 17000,
        dueLabel: null,
        pendingProofs: 0,
        periodLabel: null,
        unpaidCount: 2,
      }),
    ).toBe("Across 2 unpaid invoices");
  });

  it("names the month and when it is due for a single invoice", () => {
    expect(
      duesLine({
        dueAmount: 8500,
        dueLabel: "Due tomorrow",
        pendingProofs: 0,
        periodLabel: "Bhadra 2082",
        unpaidCount: 1,
      }),
    ).toBe("Bhadra 2082 · Due tomorrow");
  });

  it("still says something when the invoice carries neither month nor due date", () => {
    expect(
      duesLine({
        dueAmount: 8500,
        dueLabel: null,
        pendingProofs: 0,
        periodLabel: null,
        unpaidCount: 1,
      }),
    ).toBe("Payment outstanding");
  });
});

describe("stayPill", () => {
  /*
    2026-09-04 21:30 in Kathmandu (UTC+05:45), which is inside the same night as
    the check-ins below. `nightStanding` owns that arithmetic; these cases are
    only about which of the two appearances the pill takes.
  */
  const now = new Date("2026-09-04T15:45:00.000Z");

  it("is quiet once tonight's answer is on record", () => {
    expect(
      stayPill(
        night({ checkedAt: "2026-09-04T15:00:00.000Z", status: "INSIDE_HOSTEL" }),
        now,
      ),
    ).toEqual({ label: "Checked in", settled: true });

    expect(
      stayPill(
        night({ checkedAt: "2026-09-04T15:00:00.000Z", status: "MARKED_SAFE" }),
        now,
      ),
    ).toEqual({ label: "Checked in", settled: true });
  });

  it("flags a resident who has not answered tonight", () => {
    expect(stayPill(night(), now)).toEqual({
      label: "Not checked in",
      settled: false,
    });
  });

  it("flags last night's answer rather than carrying it forward", () => {
    expect(
      stayPill(
        night({ checkedAt: "2026-09-03T15:00:00.000Z", status: "INSIDE_HOSTEL" }),
        now,
      ),
    ).toEqual({ label: "Not checked in", settled: false });
  });

  it("names an SOS on the record, whatever else has been answered since", () => {
    expect(
      stayPill(
        night({ checkedAt: "2026-09-04T15:00:00.000Z", status: "SOS_TRIGGERED" }),
        now,
      ),
    ).toEqual({ label: "SOS active", settled: false });
  });
});
