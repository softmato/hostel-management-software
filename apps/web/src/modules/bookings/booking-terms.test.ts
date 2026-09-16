/**
 * The booking money rules — docs/BOOKINGS.md item 1.
 *
 * These tests are the owner's refund table written as code: 7% fee, 100% back
 * before the hostel confirms or when the hostel is at fault, 75 / 50 / 25 on
 * days 1–2 / 3–5 / 6–7, nothing for a no-show, and whatever is kept split
 * 60 / 40 between the hostel and HostelPalika.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));

import {
  DEFAULT_BOOKING_CONFIG,
  bookingConfigSchema,
  mergeBookingConfig,
} from "@/modules/bookings/booking-config";
import {
  DAY_MS,
  HOUR_MS,
  bookingFee,
  cancelRefundPercent,
  cancellationSchedule,
  holdDayAt,
  holdEndsAt,
  hostelAnswerDeadline,
  policyRows,
  settleBooking,
  splitKept,
  termsFromConfig,
  type BookingEnding,
} from "@/modules/bookings/booking-terms";

const terms = termsFromConfig(DEFAULT_BOOKING_CONFIG);
const confirmedAt = new Date("2026-09-15T09:55:00.000Z");
const after = (ms: number) => new Date(confirmedAt.getTime() + ms);

describe("the shipped defaults", () => {
  it("are the terms the owner agreed", () => {
    expect(DEFAULT_BOOKING_CONFIG).toMatchObject({
      cancelSteps: [
        { refundPercent: 75, throughDay: 2 },
        { refundPercent: 50, throughDay: 5 },
        { refundPercent: 25, throughDay: 7 },
      ],
      enabled: false,
      feePercent: 7,
      holdDays: 7,
      hostelAnswerHours: 24,
      hostelSharePercent: 60,
      noShowRefundPercent: 0,
      strikeLimit: 3,
      strikeWindowDays: 30,
    });
  });
});

describe("bookingFee", () => {
  it.each([
    [10000, 700],
    [9500, 665],
    [8333, 583],
    // 10.5 rounds away from zero, like every other amount in the product.
    [150, 11],
  ])("is 7%% of %s rent: %s", (rent, fee) => {
    expect(bookingFee(rent, 7)).toBe(fee);
  });

  it("is never zero for a priced room", () => {
    expect(bookingFee(5, 7)).toBe(1);
  });

  it("refuses a room with no rent", () => {
    expect(() => bookingFee(0, 7)).toThrow(/no rent/);
  });

  it("refuses a fractional rent rather than rounding it", () => {
    expect(() => bookingFee(9500.5, 7)).toThrow();
  });
});

describe("days of the hold", () => {
  it("counts 24-hour blocks from the confirmation", () => {
    expect(holdDayAt(confirmedAt, after(0))).toBe(1);
    expect(holdDayAt(confirmedAt, after(DAY_MS - 1))).toBe(1);
    expect(holdDayAt(confirmedAt, after(DAY_MS))).toBe(2);
    expect(holdDayAt(confirmedAt, after(7 * DAY_MS - 1))).toBe(7);
  });

  it("reads a moment before the confirmation as day 1, not day 0", () => {
    expect(holdDayAt(confirmedAt, after(-HOUR_MS))).toBe(1);
  });

  it("ends the hold seven days after the confirmation", () => {
    expect(holdEndsAt(terms, confirmedAt)).toEqual(after(7 * DAY_MS));
  });

  it("gives the hostel 24 hours from the payment check", () => {
    expect(hostelAnswerDeadline(terms, confirmedAt)).toEqual(after(24 * HOUR_MS));
  });
});

describe("cancelRefundPercent", () => {
  it.each([
    ["the first minute", 60_000, 75],
    ["the end of day 2", 2 * DAY_MS - 1, 75],
    ["the start of day 3", 2 * DAY_MS, 50],
    ["the end of day 5", 5 * DAY_MS - 1, 50],
    ["the start of day 6", 5 * DAY_MS, 25],
    ["the last millisecond of the hold", 7 * DAY_MS - 1, 25],
    // A cancel that races the no-show sweep gets exactly what the sweep gives.
    ["the end of the hold", 7 * DAY_MS, 0],
  ])("at %s is %s%%", (_label, elapsed, percent) => {
    expect(cancelRefundPercent(terms, confirmedAt, after(elapsed))).toBe(percent);
  });
});

describe("settleBooking", () => {
  const settle = (ending: BookingEnding, elapsed = 0, fee = 1000) =>
    settleBooking({ at: after(elapsed), confirmedAt, ending, fee, terms });

  it.each<BookingEnding>([
    "CANCELLED_BEFORE_CONFIRMATION",
    "DECLINED",
    "HOSTEL_NO_RESPONSE",
    "CANCELLED_BY_HOSTEL",
    "CANCELLED_BY_PLATFORM",
  ])("%s hands the whole fee back", (ending) => {
    expect(settle(ending, 6 * DAY_MS)).toEqual({
      hostelShare: 0,
      kept: 0,
      platformShare: 0,
      refund: 1000,
      refundPercent: 100,
    });
  });

  it.each([
    ["day 2", DAY_MS + HOUR_MS, { hostelShare: 150, kept: 250, platformShare: 100, refund: 750 }],
    ["day 4", 3 * DAY_MS, { hostelShare: 300, kept: 500, platformShare: 200, refund: 500 }],
    ["day 7", 6 * DAY_MS + HOUR_MS, { hostelShare: 450, kept: 750, platformShare: 300, refund: 250 }],
  ])("a person cancelling on %s follows the table", (_label, elapsed, expected) => {
    expect(settle("CANCELLED_BY_USER", elapsed)).toMatchObject(expected);
  });

  it("a no-show gets nothing back and the fee is split 60 / 40", () => {
    expect(settle("NO_SHOW", 7 * DAY_MS)).toMatchObject({
      hostelShare: 600,
      kept: 1000,
      platformShare: 400,
      refund: 0,
    });
  });

  it("a check-in keeps the whole fee, split the same way", () => {
    expect(settle("CHECKED_IN", HOUR_MS)).toMatchObject({
      hostelShare: 600,
      platformShare: 400,
      refund: 0,
    });
  });

  it("rounds the refund once and never loses a rupee", () => {
    // 75% of 665 is 498.75.
    expect(settle("CANCELLED_BY_USER", HOUR_MS, 665)).toEqual({
      hostelShare: 100,
      kept: 166,
      platformShare: 66,
      refund: 499,
      refundPercent: 75,
    });
  });

  it("sums back to the fee for every fee, ending and moment", () => {
    const endings: BookingEnding[] = [
      "CANCELLED_BY_USER",
      "NO_SHOW",
      "CHECKED_IN",
      "DECLINED",
    ];

    for (let fee = 1; fee <= 2500; fee += 37) {
      for (const ending of endings) {
        for (let hour = 0; hour <= 7 * 24; hour += 13) {
          const result = settle(ending, hour * HOUR_MS, fee);

          expect(result.refund + result.hostelShare + result.platformShare).toBe(fee);
          expect(result.refund).toBeGreaterThanOrEqual(0);
          expect(result.platformShare).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("refuses to price a cancellation with no confirmation time", () => {
    expect(() =>
      settleBooking({ at: new Date(), ending: "CANCELLED_BY_USER", fee: 700, terms }),
    ).toThrow(/confirmation time/);
  });
});

describe("splitKept", () => {
  it("gives the hostel its share and HostelPalika the rest", () => {
    expect(splitKept(1000, 60)).toEqual({ hostelShare: 600, platformShare: 400 });
    expect(splitKept(1, 60)).toEqual({ hostelShare: 1, platformShare: 0 });
    expect(splitKept(0, 60)).toEqual({ hostelShare: 0, platformShare: 0 });
  });
});

describe("the printed ladder", () => {
  it("lists days and rupees before anyone has confirmed", () => {
    expect(policyRows(terms, 700)).toEqual([
      { fromDay: 1, refund: 525, refundPercent: 75, throughDay: 2 },
      { fromDay: 3, refund: 350, refundPercent: 50, throughDay: 5 },
      { fromDay: 6, refund: 175, refundPercent: 25, throughDay: 7 },
    ]);
  });

  it("puts real times on it once the hostel confirms", () => {
    const schedule = cancellationSchedule(terms, 700, confirmedAt);

    expect(schedule.steps.map((step) => step.until)).toEqual([
      after(2 * DAY_MS),
      after(5 * DAY_MS),
      after(7 * DAY_MS),
    ]);
    expect(schedule.noShow).toEqual({ after: after(7 * DAY_MS), refund: 0, refundPercent: 0 });
  });
});

describe("bookingConfigSchema", () => {
  const valid = DEFAULT_BOOKING_CONFIG;

  it("merges a partial edit onto the stored terms", () => {
    expect(mergeBookingConfig(valid, { feePercent: 8 })).toEqual({ ...valid, feePercent: 8 });
  });

  it("needs the last step to end on the last day of the hold", () => {
    expect(bookingConfigSchema.safeParse({ ...valid, holdDays: 10 }).success).toBe(false);
  });

  it("needs each step to end later than the one before", () => {
    const result = bookingConfigSchema.safeParse({
      ...valid,
      cancelSteps: [
        { refundPercent: 75, throughDay: 5 },
        { refundPercent: 50, throughDay: 5 },
        { refundPercent: 25, throughDay: 7 },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("refuses a later step that refunds more than an earlier one", () => {
    const result = bookingConfigSchema.safeParse({
      ...valid,
      cancelSteps: [
        { refundPercent: 50, throughDay: 2 },
        { refundPercent: 75, throughDay: 7 },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("refuses a no-show refund as good as cancelling on the last day", () => {
    expect(bookingConfigSchema.safeParse({ ...valid, noShowRefundPercent: 25 }).success).toBe(
      false,
    );
    expect(bookingConfigSchema.safeParse({ ...valid, noShowRefundPercent: 10 }).success).toBe(
      true,
    );
  });

  it("keeps reminders inside the windows they remind about", () => {
    expect(
      bookingConfigSchema.safeParse({ ...valid, hostelReminderHoursLeft: [24] }).success,
    ).toBe(false);
    expect(
      bookingConfigSchema.safeParse({ ...valid, moveInReminderHoursLeft: [7 * 24] }).success,
    ).toBe(false);
  });
});
