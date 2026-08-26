import { describe, expect, it } from "vitest";

import {
  daysUntil,
  formatAgo,
  formatAmount,
  formatDate,
  formatDateBoth,
  formatDateBs,
  formatDateTime,
  formatDueLabel,
  formatMoney,
  formatPeriod,
  formatPeriodBoth,
  formatPeriodBs,
  formatRelativeDay,
  formatTime,
  greetingFor,
  humanizeEnum,
} from "@/lib/format";

/**
 * The Nepal-time cases are the ones worth having.
 *
 * NPT is UTC+05:45, so every "which day is this" question has a 5-hour-45
 * window each evening where UTC and Kathmandu disagree. Reading UTC there
 * shows yesterday's menu and dates a payment to the wrong day.
 */
describe("money", () => {
  it("groups thousands and drops empty paisa", () => {
    expect(formatAmount(8500)).toBe("8,500");
    expect(formatAmount(1234567)).toBe("1,234,567");
    expect(formatMoney(8500)).toBe("NPR 8,500");
  });

  it("keeps paisa when the amount actually has some", () => {
    // A balance that does not add up is what a resident calls about.
    expect(formatAmount(1200.5)).toBe("1,200.50");
    expect(formatMoney(0.05)).toBe("NPR 0.05");
  });

  it("renders zero and negatives rather than hiding them", () => {
    expect(formatAmount(0)).toBe("0");
    expect(formatMoney(-450)).toBe("NPR -450");
  });

  it("shows a dash for missing or non-finite values, not NaN", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(Number.NaN)).toBe("—");
  });
});

describe("dates in Nepal time", () => {
  it("rolls a late-evening UTC instant into the next Kathmandu day", () => {
    // 2026-08-16T18:30:00Z is 2026-08-17 00:15 in Kathmandu.
    expect(formatDate("2026-08-16T18:30:00.000Z")).toBe("17 Aug 2026");
    expect(formatTime("2026-08-16T18:30:00.000Z")).toBe("12:15 am");
  });

  it("formats midday and midnight without a 0 or 13 o'clock", () => {
    expect(formatTime("2026-08-16T06:15:00.000Z")).toBe("12:00 pm");
    expect(formatDateTime("2026-08-16T06:15:00.000Z")).toBe("16 Aug 2026, 12:00 pm");
  });

  it("says Today and Yesterday against a Nepal-day boundary", () => {
    const now = new Date("2026-08-16T10:00:00.000Z");

    expect(formatRelativeDay("2026-08-16T02:00:00.000Z", now)).toBe("Today");
    expect(formatRelativeDay("2026-08-15T09:00:00.000Z", now)).toBe("Yesterday");
    expect(formatRelativeDay("2026-08-10T09:00:00.000Z", now)).toBe("10 Aug 2026");
  });

  it("compares due dates as whole days, so 'due today' lasts all day", () => {
    const now = new Date("2026-08-16T23:00:00.000Z");

    expect(daysUntil("2026-08-17T04:00:00.000Z", now)).toBe(0);
    expect(formatDueLabel("2026-08-17T04:00:00.000Z", now)).toBe("Due today");
  });

  it("counts overdue days forward", () => {
    const now = new Date("2026-08-16T06:00:00.000Z");

    expect(formatDueLabel("2026-08-15T06:00:00.000Z", now)).toBe("1 day overdue");
    expect(formatDueLabel("2026-08-12T06:00:00.000Z", now)).toBe("4 days overdue");
    expect(formatDueLabel("2026-08-17T06:00:00.000Z", now)).toBe("Due tomorrow");
    expect(formatDueLabel("2026-08-20T06:00:00.000Z", now)).toBe("Due in 4 days");
  });

  it("returns a dash rather than 'Invalid Date' for junk", () => {
    expect(formatDate("not a date")).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDueLabel(null)).toBeNull();
  });
});

describe("labels", () => {
  it("expands an invoice period", () => {
    expect(formatPeriod("2026-08")).toBe("August 2026");
  });

  it("passes an unrecognised period through instead of guessing", () => {
    expect(formatPeriod("Shrawan")).toBe("Shrawan");
    expect(formatPeriod("")).toBe("—");
  });

  it("turns a shouted server enum into a sentence", () => {
    expect(humanizeEnum("PENDING_PROOF")).toBe("Pending proof");
    expect(humanizeEnum("PAID")).toBe("Paid");
    expect(humanizeEnum(null)).toBe("—");
  });

  it("greets on Kathmandu's clock, not the device's", () => {
    // 18:30 UTC is 00:15 the next day in Nepal — morning, not evening.
    expect(greetingFor(new Date("2026-08-16T18:30:00.000Z"))).toBe("Good morning");
    expect(greetingFor(new Date("2026-08-16T06:15:00.000Z"))).toBe("Good afternoon");
    expect(greetingFor(new Date("2026-08-16T13:00:00.000Z"))).toBe("Good evening");
  });
});

describe("formatDateBs / formatDateBoth", () => {
  it("converts against the Bikram Sambat New Year anchors", () => {
    // The five dates the library was adopted on. BS month lengths vary per year
    // and are tabulated data, so these are the checks that say the table is the
    // real one rather than something that merely looks plausible.
    expect(formatDateBs("2013-04-14T06:00:00.000Z")).toBe("1 Baisakh 2070");
    expect(formatDateBs("2023-04-14T06:00:00.000Z")).toBe("1 Baisakh 2080");
    expect(formatDateBs("2024-04-13T06:00:00.000Z")).toBe("1 Baisakh 2081");
    expect(formatDateBs("2025-04-14T06:00:00.000Z")).toBe("1 Baisakh 2082");
    expect(formatDateBs("2026-04-14T06:00:00.000Z")).toBe("1 Baisakh 2083");
  });

  it("shows both calendars, BS first", () => {
    // BS leads because it is the calendar the hostel quotes; AD follows because
    // it is the one the bank statement and the phone agree on.
    expect(formatDateBoth("2026-08-18T06:00:00.000Z")).toBe("2 Bhadra 2083 · 18 Aug 2026");
  });

  it("converts on the Nepal day, not the device's", () => {
    // 18:30 UTC is already the next day in Kathmandu (+05:45). A phone left on
    // another timezone must still read the date the hostel means.
    expect(formatDateBs("2026-08-18T18:30:00.000Z")).toBe("3 Bhadra 2083");
  });

  it("returns an em dash for nothing, like every other formatter here", () => {
    expect(formatDateBs(null)).toBe("—");
    expect(formatDateBoth(undefined)).toBe("—");
  });
});

describe("formatPeriodBs", () => {
  it("names both BS months a Gregorian month runs through", () => {
    // August 2026 starts in Shrawan and ends in Bhadra. Naming it after either
    // one alone is wrong for about half the days in it.
    expect(formatPeriodBs("2026-08")).toBe("Shrawan–Bhadra 2083");
  });

  it("carries both years when the Nepali new year falls inside the period", () => {
    // Baisakh 1 2083 is 14 April 2026, so April spans two BS years.
    expect(formatPeriodBs("2026-04")).toBe("Chaitra 2082–Baisakh 2083");
  });

  it("is empty for a period it cannot convert, never a guess", () => {
    expect(formatPeriodBs("not-a-period")).toBe("");
    expect(formatPeriodBs(null)).toBe("");
    expect(formatPeriodBs("2026-13")).toBe("");
  });

  it("drops the BS half rather than printing nothing when it is unavailable", () => {
    expect(formatPeriodBoth("2026-08")).toBe("August 2026 · Shrawan–Bhadra 2083");
    expect(formatPeriodBoth("not-a-period")).toBe("not-a-period");
  });
});

describe("formatAgo", () => {
  const now = new Date("2026-08-25T12:00:00.000Z");

  it("answers in the coarsest unit that is still true", () => {
    expect(formatAgo("2026-08-25T11:59:30.000Z", now)).toBe("just now");
    expect(formatAgo("2026-08-25T11:59:00.000Z", now)).toBe("1 min ago");
    expect(formatAgo("2026-08-25T11:20:00.000Z", now)).toBe("40 mins ago");
    expect(formatAgo("2026-08-25T10:00:00.000Z", now)).toBe("2 hrs ago");
    expect(formatAgo("2026-08-24T10:00:00.000Z", now)).toBe("1 day ago");
    expect(formatAgo("2026-08-20T10:00:00.000Z", now)).toBe("5 days ago");
  });

  it("hands back to a date once the arithmetic stops being worth doing", () => {
    expect(formatAgo("2026-07-25T10:00:00.000Z", now)).toBe("25 Jul 2026");
  });

  it("never reports the future for a clock a few minutes fast", () => {
    expect(formatAgo("2026-08-25T12:02:00.000Z", now)).toBe("just now");
  });
});
