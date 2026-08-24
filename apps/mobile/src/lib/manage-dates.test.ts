import { describe, expect, it } from "vitest";

import {
  dayInputFromNow,
  endOfDayIso,
  isFuture,
  isPast,
  parseDayInput,
  startOfDayIso,
  toDayInput,
} from "@/lib/manage-dates";

describe("parseDayInput", () => {
  it("reads a well-formed day", () => {
    expect(parseDayInput("2026-08-25")).toEqual({ day: 25, month: 8, year: 2026 });
  });

  it("trims surrounding space, because a keyboard adds it", () => {
    expect(parseDayInput(" 2026-08-25 ")).toEqual({ day: 25, month: 8, year: 2026 });
  });

  it("refuses a day that does not exist rather than rolling it forward", () => {
    // `new Date("2026-02-31")` is March 3rd. A typo that silently becomes a
    // different date is the failure this rejection exists to prevent.
    expect(parseDayInput("2026-02-31")).toBeNull();
    expect(parseDayInput("2026-13-01")).toBeNull();
    expect(parseDayInput("2026-00-10")).toBeNull();
  });

  it("refuses anything that is not YYYY-MM-DD", () => {
    expect(parseDayInput("25/08/2026")).toBeNull();
    expect(parseDayInput("2026-8-5")).toBeNull();
    expect(parseDayInput("")).toBeNull();
  });
});

describe("startOfDayIso / endOfDayIso", () => {
  it("starts the day at midnight in Kathmandu, not in UTC", () => {
    // UTC+5:45, so Nepal's midnight is 18:15 the previous day in UTC.
    expect(startOfDayIso("2026-08-25")).toBe("2026-08-24T18:15:00.000Z");
  });

  it("ends the day at 23:59 in Kathmandu", () => {
    expect(endOfDayIso("2026-08-25")).toBe("2026-08-25T18:14:00.000Z");
  });

  it("is null for an unparseable day", () => {
    expect(startOfDayIso("tomorrow")).toBeNull();
    expect(endOfDayIso("tomorrow")).toBeNull();
  });
});

describe("toDayInput", () => {
  it("names the day a Nepali reader would call it", () => {
    // 18:30Z on the 24th is already 00:15 on the 25th in Kathmandu.
    expect(toDayInput("2026-08-24T18:30:00.000Z")).toBe("2026-08-25");
    expect(toDayInput("2026-08-24T18:00:00.000Z")).toBe("2026-08-24");
  });

  it("is blank for nothing and for nonsense", () => {
    expect(toDayInput(null)).toBe("");
    expect(toDayInput(undefined)).toBe("");
    expect(toDayInput("not a date")).toBe("");
  });
});

describe("dayInputFromNow", () => {
  const noon = new Date("2026-08-21T06:00:00.000Z");

  it("is today at zero", () => {
    expect(dayInputFromNow(0, noon)).toBe("2026-08-21");
  });

  it("walks forward and back", () => {
    expect(dayInputFromNow(1, noon)).toBe("2026-08-22");
    expect(dayInputFromNow(7, noon)).toBe("2026-08-28");
    expect(dayInputFromNow(-1, noon)).toBe("2026-08-20");
  });
});

describe("isPast / isFuture", () => {
  const now = new Date("2026-08-21T06:00:00.000Z");

  it("splits either side of now", () => {
    expect(isPast("2026-08-20T06:00:00.000Z", now)).toBe(true);
    expect(isPast("2026-08-22T06:00:00.000Z", now)).toBe(false);
    expect(isFuture("2026-08-22T06:00:00.000Z", now)).toBe(true);
    expect(isFuture("2026-08-20T06:00:00.000Z", now)).toBe(false);
  });

  it("treats an absent date as neither", () => {
    // A notice with no `expiresAt` never expires — it is not "expired at the
    // epoch", which is what a naive `new Date(undefined)` would decide.
    expect(isPast(undefined, now)).toBe(false);
    expect(isFuture(undefined, now)).toBe(false);
    expect(isPast("", now)).toBe(false);
  });
});
