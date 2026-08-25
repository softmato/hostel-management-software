import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import type { FeeScheduleRecord } from "@/modules/finance/fee-schedule.service";
import { periodOfDate, quoteIntake } from "@/modules/residents/resident-intake.service";

/**
 * The intake quote, as arithmetic.
 *
 * Every case here is one somebody will actually walk into the office with: a
 * hostel that has not written a rate card yet, a room type nobody thought to
 * price, a referral code against a hostel that offers no discount, and a
 * discount left standing after the fee it came off was lowered.
 */

const scheduleId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f1");

function schedule(overrides: Partial<FeeScheduleRecord> = {}): FeeScheduleRecord {
  return {
    _id: scheduleId,
    admissionFee: 5000,
    depositAmount: 8000,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    hostelId: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f2"),
    rates: [{ bedType: "FOUR_SHARING", monthlyAmount: 6000 }],
    referralAdmissionDiscount: 1500,
    ...overrides,
  };
}

const hostel = {
  pricing: { admissionFee: 9999, currency: "NPR" },
  roomConfigurations: [{ monthlyRent: 7777, roomType: "Four Sharing" }],
};

describe("intake quote", () => {
  it("prices the rent from the rate card, not the room's listed rent", () => {
    const result = quoteIntake({
      hostel,
      referralCodeActive: false,
      roomType: "Four Sharing",
      schedule: schedule(),
    });

    // 7777 is what the owner typed into their listing when they signed up;
    // 6000 is what billing will actually invoice. Quoting the listing price at
    // the door is how a resident ends up arguing with their first bill.
    expect(result.monthlyRent).toBe(6000);
    expect(result.rentBasis).toBe("SCHEDULE");
    expect(result.admissionFee).toBe(5000);
    expect(result.depositAmount).toBe(8000);
  });

  it("falls back to the room configuration when no rate card covers the move-in", () => {
    const result = quoteIntake({
      hostel,
      referralCodeActive: false,
      roomType: "Four Sharing",
      schedule: null,
    });

    expect(result).toMatchObject({
      admissionFee: 9999,
      feeScheduleId: null,
      monthlyRent: 7777,
      rentBasis: "ROOM_CONFIGURATION",
    });
  });

  it("reports an unpriced room type rather than quoting zero", () => {
    const result = quoteIntake({
      hostel,
      referralCodeActive: false,
      // Real data from the development database. It does not say how many people
      // share, and two and five differ by thousands — so nothing prices it.
      roomType: "Shared",
      schedule: schedule(),
    });

    expect(result.bedType).toBeNull();
    expect(result.monthlyRent).toBeNull();
    expect(result.rentBasis).toBe("UNPRICED");
  });

  it("takes the referral discount off the admission fee only", () => {
    const result = quoteIntake({
      hostel,
      referralCode: "hh-asha1",
      referralCodeActive: true,
      roomType: "Four Sharing",
      schedule: schedule(),
    });

    expect(result.referral).toMatchObject({
      applied: true,
      code: "HH-ASHA1",
      discount: 1500,
      reason: null,
    });
    expect(result.admissionPayable).toBe(3500);
    // The rent is untouched: a referral is a one-time thank-you, not a standing
    // rate that makes this resident permanently cheaper than the next bed.
    expect(result.monthlyRent).toBe(6000);
  });

  it("ignores a code that is not live in this hostel, and says so", () => {
    const result = quoteIntake({
      hostel,
      referralCode: "MADEUP",
      referralCodeActive: false,
      roomType: "Four Sharing",
      schedule: schedule(),
    });

    expect(result.referral.applied).toBe(false);
    expect(result.admissionPayable).toBe(5000);
    expect(result.referral.reason).toMatch(/not active/i);
  });

  it("explains a valid code that earns nothing rather than looking broken", () => {
    const result = quoteIntake({
      hostel,
      referralCode: "HH-ASHA1",
      referralCodeActive: true,
      roomType: "Four Sharing",
      schedule: schedule({ referralAdmissionDiscount: 0 }),
    });

    expect(result.referral.applied).toBe(false);
    expect(result.referral.reason).toMatch(/no referral discount/i);
    // The referrer is still credited — the link is made regardless of money.
    expect(result.referral.code).toBe("HH-ASHA1");
  });

  it("never lets the discount exceed the fee it comes off", () => {
    // A card written before the validation rule existed, or one whose admission
    // fee was lowered afterwards without the discount following it.
    const result = quoteIntake({
      hostel,
      referralCode: "HH-ASHA1",
      referralCodeActive: true,
      roomType: "Four Sharing",
      schedule: schedule({ admissionFee: 1000, referralAdmissionDiscount: 4000 }),
    });

    expect(result.referral.discount).toBe(1000);
    // Not negative: an invoice that owes somebody money for moving in.
    expect(result.admissionPayable).toBe(0);
  });

  it("has nothing to discount when the hostel levies no admission fee", () => {
    const result = quoteIntake({
      hostel: { pricing: {}, roomConfigurations: [] },
      referralCode: "HH-ASHA1",
      referralCodeActive: true,
      roomType: "Four Sharing",
      schedule: schedule({ admissionFee: 0 }),
    });

    expect(result.admissionFee).toBe(0);
    expect(result.referral.discount).toBe(0);
    expect(result.referral.reason).toMatch(/no admission fee/i);
  });

  it("reads the move-in month in UTC, so the schedule chosen does not drift", () => {
    // 23:30 on the 31st in Kathmandu is still January in UTC — and picking
    // February here would price the intake off a rate card that has not started.
    expect(periodOfDate(new Date("2026-01-31T23:30:00.000Z"))).toBe("2026-01");
    expect(periodOfDate(new Date("2026-02-01T00:00:00.000Z"))).toBe("2026-02");
  });
});
