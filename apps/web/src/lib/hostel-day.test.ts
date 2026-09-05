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

/**
 * A period is a **Bikram Sambat** month.
 *
 * These cases used to assert `2026-09` for a September instant, which is the
 * whole defect: the arithmetic ran on a Gregorian month and the screens printed
 * a Nepali name over it. Bhadra 2083 is 17 August to 16 September 2026, so the
 * boundary these tests care about is nowhere near the 1st of anything.
 */
describe("hostelPeriodOf", () => {
  it("names the BS month, not the Gregorian one it mostly overlaps", () => {
    // 3 September 2026 is Bhadra 18, 2083 — not "September".
    expect(hostelPeriodOf(new Date("2026-09-03T00:00:00.000Z"))).toBe("2083-05");
  });

  it("turns the month over on the BS boundary, not the Gregorian one", () => {
    // Bhadra 31 is 16 September; Aswin 1 is the 17th. Mid-Gregorian-month.
    expect(hostelPeriodOf(new Date("2026-09-16T12:00:00.000Z"))).toBe("2083-05");
    expect(hostelPeriodOf(new Date("2026-09-17T12:00:00.000Z"))).toBe("2083-06");
  });

  it("reads the hostel's day, so a late UTC instant is already the next one", () => {
    // 18:15 UTC on 16 September is midnight on the 17th in Kathmandu — Aswin 1,
    // and therefore the next month, with no Gregorian month having changed.
    expect(hostelPeriodOf(new Date("2026-09-16T18:15:00.000Z"))).toBe("2083-06");
    expect(hostelPeriodOf(new Date("2026-09-16T18:14:00.000Z"))).toBe("2083-05");
  });

  it("rolls the year over on Baisakh 1, which is the Nepali new year", () => {
    // 13 April 2027 is Chaitra 2083; the 14th is Baisakh 2084.
    expect(hostelPeriodOf(new Date("2027-04-13T06:00:00.000Z"))).toBe("2083-12");
    expect(hostelPeriodOf(new Date("2027-04-14T06:00:00.000Z"))).toBe("2084-01");
  });
});

describe("hostelToday", () => {
  it("is the hostel's day, not the UTC one", () => {
    expect(iso(hostelToday(new Date("2026-08-31T20:00:00.000Z")))).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });
});

/**
 * Rates change on the first of a **BS** month.
 *
 * That is the month an owner means when they say "from next month" — the one
 * their books, their notice board and their receipt pad all run on. Pulling a
 * date back to the Gregorian 1st, which this used to do, put a card's start a
 * fortnight away from the month it was named after.
 */
describe("hostelMonthStart", () => {
  it("pulls a mid-month date back to the first of its BS month", () => {
    // 2 October 2026 is Aswin 16. Aswin 1 is 17 September.
    expect(iso(hostelMonthStart(new Date("2026-10-02T18:15:00.000Z")))).toBe(
      "2026-09-17T00:00:00.000Z",
    );
  });

  it("leaves the first of a BS month where it is", () => {
    expect(iso(hostelMonthStart(new Date("2026-09-17T00:00:00.000Z")))).toBe(
      "2026-09-17T00:00:00.000Z",
    );
  });

  it("uses the hostel's day, so a late UTC instant starts the next month", () => {
    // 18:15 UTC on 16 September is already Aswin 1 in Kathmandu.
    expect(iso(hostelMonthStart(new Date("2026-09-16T18:15:00.000Z")))).toBe(
      "2026-09-17T00:00:00.000Z",
    );
    // And a minute earlier is still Bhadra, which began on 17 August.
    expect(iso(hostelMonthStart(new Date("2026-09-16T18:14:00.000Z")))).toBe(
      "2026-08-17T00:00:00.000Z",
    );
  });
});
