import { describe, expect, it } from "vitest";

import {
  hostelCalendarDay,
  hostelMonthStart,
  hostelPeriodOf,
  hostelToday,
} from "@/lib/hostel-day";

const iso = (date: Date) => date.toISOString();

describe("hostelCalendarDay", () => {
  it("keeps a midnight-in-Nepal move-in on the day the resident actually arrived", () => {
    // What a Nepali date picker sends for "3 September".
    expect(iso(hostelCalendarDay(new Date("2026-09-02T18:15:00.000Z")))).toBe(
      "2026-09-03T00:00:00.000Z",
    );
  });

  it("does not move a value it has already normalised", () => {
    const once = hostelCalendarDay(new Date("2026-09-02T18:15:00.000Z"));

    expect(iso(hostelCalendarDay(once))).toBe(iso(once));
  });

  it("holds the last UTC minute of a day on that day", () => {
    // 23:59 UTC is 05:44 the next morning in Nepal — a different calendar day.
    expect(iso(hostelCalendarDay(new Date("2026-09-03T23:59:00.000Z")))).toBe(
      "2026-09-04T00:00:00.000Z",
    );
  });

  it("holds an instant just before the local rollover on the earlier day", () => {
    expect(iso(hostelCalendarDay(new Date("2026-09-03T18:14:59.999Z")))).toBe(
      "2026-09-03T00:00:00.000Z",
    );
  });
});

describe("hostelPeriodOf", () => {
  it("bills a 1 September move-in to September, not to August", () => {
    // The month-boundary case: midnight on 1 Sep in Nepal is 31 Aug in UTC.
    expect(hostelPeriodOf(new Date("2026-08-31T18:15:00.000Z"))).toBe("2026-09");
  });

  it("still reads a plain UTC date as its own month", () => {
    expect(hostelPeriodOf(new Date("2026-09-03T00:00:00.000Z"))).toBe("2026-09");
  });

  it("rolls the year over with the month", () => {
    expect(hostelPeriodOf(new Date("2026-12-31T18:15:00.000Z"))).toBe("2027-01");
  });
});

describe("hostelToday", () => {
  it("is the hostel's day, not the UTC one", () => {
    expect(iso(hostelToday(new Date("2026-08-31T20:00:00.000Z")))).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });
});

describe("hostelMonthStart", () => {
  it("pulls a mid-month date back to the first of its month", () => {
    // The bug an owner hit: a "next month" button that added thirty days gave
    // 3 October, and the card then claimed to start mid-month.
    expect(iso(hostelMonthStart(new Date("2026-10-02T18:15:00.000Z")))).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("leaves the first of a month where it is", () => {
    expect(iso(hostelMonthStart(new Date("2026-10-01T00:00:00.000Z")))).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("uses the hostel's month, not UTC's", () => {
    // 18:15 UTC on 30 September is already 1 October in Kathmandu.
    expect(iso(hostelMonthStart(new Date("2026-09-30T18:15:00.000Z")))).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });
});
