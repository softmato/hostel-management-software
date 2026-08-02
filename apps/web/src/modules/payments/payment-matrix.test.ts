import { describe, expect, it } from "vitest";

import { computeMonthlyDue } from "@/modules/payments/payment.service";

describe("computeMonthlyDue", () => {
  it("charges the full fee when the resident moved in before the month", () => {
    expect(computeMonthlyDue(9000, new Date("2026-03-10T00:00:00Z"), "2026-07")).toBe(
      9000,
    );
  });

  it("charges the full fee when move-in is on the 1st", () => {
    expect(computeMonthlyDue(9000, new Date("2026-07-01T00:00:00Z"), "2026-07")).toBe(
      9000,
    );
  });

  it("pro-rates a mid-month move-in by remaining days", () => {
    // July has 31 days; moving in on the 16th leaves 16 billable days.
    expect(computeMonthlyDue(3100, new Date("2026-07-16T00:00:00Z"), "2026-07")).toBe(
      1600,
    );
  });

  it("charges a single day for a month-end move-in", () => {
    expect(computeMonthlyDue(3100, new Date("2026-07-31T00:00:00Z"), "2026-07")).toBe(
      100,
    );
  });

  it("charges nothing for months before the move-in", () => {
    expect(computeMonthlyDue(9000, new Date("2026-08-02T00:00:00Z"), "2026-07")).toBe(0);
  });

  it("handles February lengths", () => {
    // 2026 February has 28 days; move-in on the 15th → 14 billable days.
    expect(computeMonthlyDue(2800, new Date("2026-02-15T00:00:00Z"), "2026-02")).toBe(
      1400,
    );
  });
});
