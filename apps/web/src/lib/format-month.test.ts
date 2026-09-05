import { describe, expect, it } from "vitest";

import { dayMonthYear, monthLabel, periodKey, shortMonthLabel } from "@/lib/format-month";
import { hostelPeriodOf } from "@/lib/hostel-day";

describe("monthLabel", () => {
  it("spells out a ledger period in the calendar it is keyed by", () => {
    expect(monthLabel("2083-05")).toBe("Bhadra 2083 BS");
  });

  /*
   * A row written before billing moved to Bikram Sambat. Indexing the English
   * month table with `2083-05` would print "May 2083" — the right two numbers,
   * the wrong calendar, 57 years out — so the two are told apart rather than
   * both run through one table.
   */
  it("leaves a pre-migration Gregorian key as the month it always meant", () => {
    expect(monthLabel("2026-07")).toBe("July 2026");
  });

  it("returns a dash for nothing, so a screen never renders 'undefined'", () => {
    expect(monthLabel(null)).toBe("—");
    expect(monthLabel("")).toBe("—");
  });

  it("passes through anything that is not a period key", () => {
    // Callers already holding a formatted string must not be made worse.
    expect(monthLabel("July 2026")).toBe("July 2026");
  });

  it("rejects an impossible month rather than inventing one", () => {
    expect(monthLabel("2026-13")).toBe("2026-13");
  });
});

describe("shortMonthLabel", () => {
  /*
   * The era comes off; the month name does not get abbreviated. Bhadra and
   * Baisakh both shorten to three letters that do not tell them apart, and
   * neither do Mangsir and Magh.
   */
  it("drops the era for badges rather than clipping the month", () => {
    expect(shortMonthLabel("2083-05")).toBe("Bhadra 2083");
  });

  it("still abbreviates a pre-migration Gregorian key", () => {
    expect(shortMonthLabel("2026-09")).toBe("Sep 2026");
  });
});

describe("dayMonthYear", () => {
  it("is never the ambiguous numeric form", () => {
    // "9/1/2026" is September in one half of the world and January in the
    // other, and this string sits next to a rent amount.
    const formatted = dayMonthYear("2026-09-01T00:00:00.000Z");

    expect(formatted).toContain("Sep");
    expect(formatted).toContain("2026");
    expect(formatted).not.toContain("/");
  });

  it("degrades to a dash rather than 'Invalid Date'", () => {
    expect(dayMonthYear("not a date")).toBe("—");
    expect(dayMonthYear(null)).toBe("—");
  });
});

/**
 * The key the screens send the server, which has to be the server's own.
 *
 * Asserted against `hostelPeriodOf` rather than against a literal: a literal
 * would still pass on the day one of the two implementations drifted, and
 * "the web asks for a month the server has no invoices in" is a bug that shows
 * up as an empty table with no error on it.
 */
describe("periodKey", () => {
  it("is the same string the server keys invoices by", () => {
    for (const instant of [
      new Date("2026-09-04T06:00:00.000Z"),
      new Date("2026-09-16T18:30:00.000Z"),
      new Date("2027-04-14T06:00:00.000Z"),
    ]) {
      expect(periodKey(instant)).toBe(hostelPeriodOf(instant));
    }
  });

  it("pads the month so keys sort as strings", () => {
    expect(periodKey(new Date("2026-04-20T06:00:00.000Z"))).toBe("2083-01");
  });
});
