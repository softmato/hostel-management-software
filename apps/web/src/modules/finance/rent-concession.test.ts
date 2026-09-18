import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import {
  computeInvoiceAmount,
  discountRent,
  resolveMonthlyCharge,
} from "@/modules/finance/fee-schedule.service";

/**
 * The festival month — Dashain at half rent, on top of an unchanged rate card.
 *
 * The rate card is not touched by a discount, so the only thing that can go wrong
 * is the arithmetic and which rents it reaches. Both are asserted here rather
 * than through the billing run, because the run's own tests already prove that
 * whatever `resolveMonthlyCharge` returns is what lands on the invoice.
 */

const hostelRate = {
  _id: new Types.ObjectId(),
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  hostelId: new Types.ObjectId(),
  effectiveTo: null,
  rates: [{ currency: "NPR", monthlyAmount: 8_000, roomType: "Double" }],
};

const resident = {
  _id: new Types.ObjectId(),
  bedType: null,
  monthlyFee: null,
  moveInDate: new Date("2020-01-01T00:00:00.000Z"),
  moveOutDate: null,
  roomType: "Double",
};

describe("discountRent", () => {
  it("takes the stated percent off", () => {
    expect(discountRent(8_000, 50)).toBe(4_000);
    expect(discountRent(8_000, 25)).toBe(6_000);
  });

  it("gives the odd rupee to the resident", () => {
    // 50% of 8,001 is 4,000.5. The discount floors to 4,000, so the resident is
    // charged 4,001 — never more than the half the hostel announced.
    expect(discountRent(8_001, 50)).toBe(4_001);
    expect(discountRent(8_001, 50) + 4_000).toBe(8_001);
  });

  it("charges nothing at 100% and everything at 0", () => {
    expect(discountRent(8_000, 100)).toBe(0);
    expect(discountRent(8_000, 0)).toBe(8_000);
  });
});

describe("resolveMonthlyCharge with a month discount", () => {
  it("reduces a scheduled rate and keeps the full rent beside it", () => {
    const charge = resolveMonthlyCharge(resident, hostelRate, new Map(), 50);

    expect(charge.amount).toBe(4_000);
    expect(charge.fullAmount).toBe(8_000);
    expect(charge.concessionPercent).toBe(50);
    // The card is untouched: the basis still points at the schedule that priced
    // the bed, because a discounted month is not a different price for the bed.
    expect(charge.basis).toBe("SCHEDULE");
    expect(charge.feeScheduleId).toBe(hostelRate._id);
  });

  it("reduces a per-resident override too", () => {
    // A negotiated rate is still rent, and a hostel that says "half fee in
    // Dashain" means everybody — not everybody except the four people whose rent
    // was agreed at the desk.
    const charge = resolveMonthlyCharge(
      { ...resident, monthlyFee: 6_000 },
      null,
      new Map(),
      50,
    );

    expect(charge.amount).toBe(3_000);
    expect(charge.basis).toBe("OVERRIDE");
  });

  it("reduces a listed room rent too", () => {
    const charge = resolveMonthlyCharge(
      resident,
      null,
      new Map([["Double", 8_000]]),
      50,
    );

    expect(charge.amount).toBe(4_000);
    expect(charge.basis).toBe("MANUAL");
  });

  it("leaves the charge alone at full rent", () => {
    const charge = resolveMonthlyCharge(resident, hostelRate, new Map());

    expect(charge.amount).toBe(8_000);
    expect(charge.concessionPercent).toBe(0);
  });

  it("still prorates a part month, on the discounted rent", () => {
    // Bhadra 2083 is 31 days. Moving in on its 19th day is 13 billable days, so
    // half rent prorated is half of the prorated full rent — one whole-rupee
    // step, not two.
    const charge = resolveMonthlyCharge(resident, hostelRate, new Map(), 50);
    const part = computeInvoiceAmount(
      charge.amount,
      new Date("2026-09-04T00:00:00.000Z"),
      null,
      "2083-05",
    );

    expect(part.amount).toBeLessThan(charge.amount);
    expect(part.prorationBasis).toContain("of 31 days");
  });
});
