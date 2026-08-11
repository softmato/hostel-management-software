import { describe, expect, it } from "vitest";

import { dayMonthYear, monthLabel, periodKey, shortMonthLabel } from "@/lib/format-month";

describe("monthLabel", () => {
  it("spells out a ledger period", () => {
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
  it("abbreviates for badges and table cells", () => {
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

describe("periodKey", () => {
  it("pads the month so keys sort as strings", () => {
    expect(periodKey(new Date(2026, 0, 15))).toBe("2026-01");
  });
});
