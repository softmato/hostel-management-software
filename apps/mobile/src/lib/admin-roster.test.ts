import { describe, expect, it } from "vitest";

import type { AdminResident } from "@/lib/admin-api";
import {
  rosterSegmentRows,
  rosterSummary,
  searchResidents,
} from "@/lib/admin-roster";

function resident(status: string): AdminResident {
  return {
    email: `${status}@example.com`,
    firstName: "A",
    id: `${status}-${Math.random()}`,
    lastName: "B",
    monthlyFee: 8000,
    moveInDate: "2026-01-01",
    phone: "9800000000",
    residentType: "STUDENT",
    roomType: "Double",
    status,
  };
}

describe("rosterSummary", () => {
  it("separates who lives here from who is on the list", () => {
    const summary = rosterSummary([
      resident("ACTIVE"),
      resident("ACTIVE"),
      resident("PENDING"),
      resident("MOVED_OUT"),
    ]);

    expect(summary).toEqual({ active: 2, pending: 1, total: 4 });
  });

  it("does not count a former resident as living here", () => {
    // The list is unfiltered, so turnover accumulates in it. Counting those
    // would put "58 residents" on the banner of a hostel with 40 beds.
    expect(rosterSummary([resident("MOVED_OUT"), resident("MOVED_OUT")])).toEqual({
      active: 0,
      pending: 0,
      total: 2,
    });
  });

  it("leaves a status it has never heard of out of both buckets", () => {
    // `active` is checked against real beds. A new enum member folded into it
    // is wrong in the direction nobody notices; in `total` alone it is visible.
    const summary = rosterSummary([resident("ACTIVE"), resident("ON_LEAVE")]);

    expect(summary).toEqual({ active: 1, pending: 0, total: 2 });
  });

  it("is all zeroes for an empty roster", () => {
    expect(rosterSummary([])).toEqual({ active: 0, pending: 0, total: 0 });
  });
});

function named(first: string, last: string, extra: Partial<AdminResident> = {}): AdminResident {
  return { ...resident("ACTIVE"), firstName: first, lastName: last, ...extra };
}

describe("rosterSegmentRows", () => {
  const rows = [resident("ACTIVE"), resident("PENDING"), resident("MOVED_OUT")];

  it("shows only who lives here", () => {
    expect(rosterSegmentRows(rows, "active").map((r) => r.status)).toEqual(["ACTIVE"]);
  });

  it("shows only who is still to move in", () => {
    expect(rosterSegmentRows(rows, "pending").map((r) => r.status)).toEqual(["PENDING"]);
  });

  it("shows everyone the list returned, former residents included", () => {
    expect(rosterSegmentRows(rows, "all")).toHaveLength(3);
  });

  it("does not mutate the array it was given", () => {
    const source = [...rows];

    rosterSegmentRows(source, "all");

    expect(source).toHaveLength(3);
  });
});

describe("searchResidents", () => {
  const rows = [
    named("Aadarsh", "Yadav", { phone: "9810140187", roomType: "Four sharing" }),
    named("Bimal", "Shrestha", { phone: "9800000001", roomType: "Single" }),
  ];

  it("matches a name whatever the case", () => {
    expect(searchResidents(rows, "aadarsh").map((r) => r.firstName)).toEqual(["Aadarsh"]);
    expect(searchResidents(rows, "SHRESTHA").map((r) => r.firstName)).toEqual(["Bimal"]);
  });

  it("matches a phone number", () => {
    expect(searchResidents(rows, "9810140").map((r) => r.firstName)).toEqual(["Aadarsh"]);
  });

  it("matches across the fields, so a name and a room type together still find the row", () => {
    expect(searchResidents(rows, "yadav 9810").map((r) => r.firstName)).toEqual(["Aadarsh"]);
  });

  it("returns everything for an empty or blank query", () => {
    // The field starts empty. A search that starts by hiding the list is a
    // list somebody assumes failed to load.
    expect(searchResidents(rows, "")).toHaveLength(2);
    expect(searchResidents(rows, "   ")).toHaveLength(2);
  });

  it("returns nothing when nothing matches, rather than everything", () => {
    expect(searchResidents(rows, "zzz")).toEqual([]);
  });
});
