import { describe, expect, it } from "vitest";

import type { AdminNightStatusRow } from "@/lib/admin-api";
import {
  filterRollCall,
  rollCallCounts,
  rollCallTone,
  ROLL_CALL_SEGMENTS,
} from "@/lib/roll-call";

function row(fullName: string, status: string, roomType = "SINGLE"): AdminNightStatusRow {
  return {
    resident: { fullName, id: fullName, roomType, status: "ACTIVE" },
    status: { checkedAt: null, note: "", source: "SELF", status },
  };
}

const ROSTER: AdminNightStatusRow[] = [
  row("Asha Gurung", "NOT_VERIFIED"),
  row("Bikash Rai", "INSIDE_HOSTEL", "DOUBLE"),
  row("Chetan Shah", "OUTSIDE_HOSTEL"),
  row("Deepa Karki", "MARKED_SAFE"),
  row("Eshan Thapa", "NOT_VERIFIED", "DOUBLE"),
  row("Farhan Ali", "SOS_TRIGGERED"),
];

describe("ROLL_CALL_SEGMENTS", () => {
  it("leads with the only segment that has work in it", () => {
    // A warden opens this at 10pm to clear the people nobody has marked. `All`
    // in the first slot would make the default view a roster that is mostly
    // settled rows by midnight.
    expect(ROLL_CALL_SEGMENTS[0].value).toBe("unverified");
  });

  it("stays within Segmented's cap of five", () => {
    expect(ROLL_CALL_SEGMENTS).toHaveLength(5);
  });

  it("has no SOS segment", () => {
    // An active emergency is a banner and a push. A `1` on a tab is the
    // quietest possible way to report one.
    expect(ROLL_CALL_SEGMENTS.some((segment) => segment.status === "SOS_TRIGGERED")).toBe(
      false,
    );
  });
});

describe("rollCallCounts", () => {
  it("counts every segment over the whole roster", () => {
    expect(rollCallCounts(ROSTER)).toEqual({
      all: 6,
      inside: 1,
      outside: 1,
      safe: 1,
      unverified: 2,
    });
  });

  it("counts an SOS row in All and in nothing else", () => {
    // It has to be reachable — it is a person nobody has accounted for — but it
    // belongs to no segment, so `all` is the only place it can be found.
    const counts = rollCallCounts([row("Farhan Ali", "SOS_TRIGGERED")]);

    expect(counts.all).toBe(1);
    expect(counts.inside + counts.outside + counts.safe + counts.unverified).toBe(0);
  });
});

describe("filterRollCall", () => {
  it("narrows to a segment", () => {
    const visible = filterRollCall(ROSTER, { query: "", segment: "unverified" });

    expect(visible.map((entry) => entry.resident.fullName)).toEqual([
      "Asha Gurung",
      "Eshan Thapa",
    ]);
  });

  it("shows an SOS row under All", () => {
    const visible = filterRollCall(ROSTER, { query: "", segment: "all" });

    expect(visible).toHaveLength(6);
    expect(visible.some((entry) => entry.status.status === "SOS_TRIGGERED")).toBe(true);
  });

  it("searches by name inside the chosen segment, not across it", () => {
    // Bikash is inside the hostel, so searching his name from the `To check`
    // segment must find nothing — otherwise the segment is a suggestion rather
    // than a filter, and a warden marks somebody who was already marked.
    expect(filterRollCall(ROSTER, { query: "bikash", segment: "unverified" })).toEqual([]);
    expect(
      filterRollCall(ROSTER, { query: "bikash", segment: "all" }).map(
        (entry) => entry.resident.fullName,
      ),
    ).toEqual(["Bikash Rai"]);
  });

  it("matches the room type as well as the name", () => {
    const visible = filterRollCall(ROSTER, { query: "double", segment: "all" });

    expect(visible.map((entry) => entry.resident.fullName)).toEqual([
      "Bikash Rai",
      "Eshan Thapa",
    ]);
  });

  it("ignores case and surrounding space", () => {
    expect(
      filterRollCall(ROSTER, { query: "   ASHA  ", segment: "all" }).map(
        (entry) => entry.resident.fullName,
      ),
    ).toEqual(["Asha Gurung"]);
  });

  it("returns the whole segment for an empty query", () => {
    expect(filterRollCall(ROSTER, { query: "   ", segment: "all" })).toHaveLength(6);
  });
});

describe("rollCallTone", () => {
  it("keeps unverified neutral rather than red", () => {
    // Forty grey rows at 6pm is an evening that has not started. Forty red ones
    // is an alarm, and a screen that cries every night stops being read.
    expect(rollCallTone("NOT_VERIFIED")).toBe("neutral");
    expect(rollCallTone("SOS_TRIGGERED")).toBe("danger");
  });

  it("counts marked-safe as settled, the same as inside", () => {
    // Someone safe at their aunt's house is accounted for. This agrees with
    // AdminRollCallCard, which adds the two together for its progress bar.
    expect(rollCallTone("MARKED_SAFE")).toBe("success");
    expect(rollCallTone("INSIDE_HOSTEL")).toBe("success");
  });

  it("falls back to neutral for a status it has never seen", () => {
    expect(rollCallTone("SOMETHING_NEW")).toBe("neutral");
  });
});
