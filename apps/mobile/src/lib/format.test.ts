import { describe, expect, it } from "vitest";

import {
  daysUntil,
  formatAmount,
  formatDate,
  formatDateTime,
  formatDueLabel,
  formatMoney,
  formatPeriod,
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
