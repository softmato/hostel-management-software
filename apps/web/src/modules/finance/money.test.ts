/**
 * Whole-rupee money helpers — Block 1 item 1.2 of
 * docs/FINANCE_IMPLEMENTATION_PLAN.md (ADR-1, §3.1).
 *
 * ADR-1 keeps money as `Number` in whole rupees and buys back the safety of
 * minor units by enforcing integrality. That trade is only sound if the
 * enforcement is real, so this module has no I/O and no excuse: the tests below
 * are the specification of "no code path may write a fractional amount".
 */
import { describe, expect, it } from "vitest";

import {
  assertWholeRupees,
  formatNPR,
  isWholeRupees,
  prorate,
  roundToRupee,
  splitAmount,
  sumAmounts,
} from "@/modules/finance/money";

describe("assertWholeRupees", () => {
  it.each([0, 1, 1500, -1500, 12000, Number.MAX_SAFE_INTEGER])(
    "accepts the whole amount %s",
    (amount) => {
      expect(assertWholeRupees(amount)).toBe(amount);
    },
  );

  // The load-bearing rule of ADR-1. Rounding here instead of throwing would
  // hide the arithmetic that produced the fraction, which is the thing worth
  // knowing about.
  it.each([0.5, 1499.9999999, -0.01, 12000.5])(
    "throws rather than rounding the fractional %s",
    (amount) => {
      expect(() => assertWholeRupees(amount)).toThrow(/whole number of rupees/);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws on the non-finite %s",
    (amount) => {
      expect(() => assertWholeRupees(amount)).toThrow(/finite/);
    },
  );

  it("throws beyond exact integer representation", () => {
    expect(() => assertWholeRupees(Number.MAX_SAFE_INTEGER + 2)).toThrow(/too large/);
  });

  it("raises AMOUNT_OUT_OF_BOUNDS so routes answer 422", () => {
    expect(() => assertWholeRupees(1.5)).toThrow(
      expect.objectContaining({ errorCode: "AMOUNT_OUT_OF_BOUNDS", status: 422 }),
    );
  });

  it("names the offending field", () => {
    expect(() => assertWholeRupees(1.5, "deposit")).toThrow(/deposit/);
  });

  it("guards without throwing via isWholeRupees", () => {
    expect(isWholeRupees(1500)).toBe(true);
    expect(isWholeRupees(1500.5)).toBe(false);
    expect(isWholeRupees("1500")).toBe(false);
    expect(isWholeRupees(Number.NaN)).toBe(false);
  });
});

describe("roundToRupee", () => {
  it.each([
    [1499.4, 1499],
    [1499.5, 1500],
    [1499.6, 1500],
    [0.4, 0],
    [0, 0],
  ] as const)("rounds %s to %s", (input, expected) => {
    expect(roundToRupee(input)).toBe(expected);
  });

  /**
   * Math.round breaks ties towards +∞, so it would send -0.5 to -0 and bias a
   * run of .5 cases upward. Away-from-zero makes a reversal the exact mirror of
   * the credit it reverses — and the two are summed together, so a one-rupee
   * asymmetry is a permanent drift.
   */
  it.each([
    [-1499.5, -1500],
    [-0.5, -1],
    [-1499.4, -1499],
  ] as const)("rounds the negative %s away from zero, to %s", (input, expected) => {
    expect(roundToRupee(input)).toBe(expected);
  });

  it("mirrors a credit and its reversal exactly", () => {
    const credit = roundToRupee(4166.5);

    expect(credit + roundToRupee(-4166.5)).toBe(0);
  });

  it("throws on a non-finite input", () => {
    expect(() => roundToRupee(Number.NaN)).toThrow();
  });
});

describe("sumAmounts", () => {
  it("sums an event log exactly", () => {
    expect(sumAmounts([12000, 5000, 3000])).toBe(20000);
  });

  it("nets credits against debits", () => {
    expect(sumAmounts([12000, -12000])).toBe(0);
  });

  it("is zero for an empty log", () => {
    expect(sumAmounts([])).toBe(0);
  });

  // If a fraction reaches the sum then something bypassed roundToRupee, and the
  // ledger's exactness claim is void from that point on — so it fails loudly.
  it("throws when any input is fractional", () => {
    expect(() => sumAmounts([12000, 0.5])).toThrow(/whole number of rupees/);
  });

  it("stays exact across a long log where float addition would drift", () => {
    const log = Array.from({ length: 10000 }, () => 8333);

    expect(sumAmounts(log)).toBe(83330000);
  });
});

describe("prorate", () => {
  it("charges the full month when every day is billable", () => {
    expect(prorate(12000, 31, 31)).toBe(12000);
  });

  // Not a computed approximation of the rent: twelve full months must bill
  // exactly twelve times the rent, with no drift to explain.
  it("returns the untouched monthly amount for a full month", () => {
    const monthly = 9999;
    const year = Array.from({ length: 12 }, () => prorate(monthly, 30, 30));

    expect(sumAmounts(year)).toBe(monthly * 12);
  });

  it("charges the full month when the day count overruns", () => {
    expect(prorate(12000, 45, 31)).toBe(12000);
  });

  it("prorates a partial month to the nearest rupee", () => {
    // 12000 / 31 * 18 = 6967.74…
    expect(prorate(12000, 18, 31)).toBe(6968);
  });

  it("handles February", () => {
    expect(prorate(12000, 14, 28)).toBe(6000);
    expect(prorate(12000, 29, 29)).toBe(12000);
  });

  it("charges one day of a month", () => {
    expect(prorate(12000, 1, 31)).toBe(387);
  });

  it("charges nothing for zero or negative days", () => {
    expect(prorate(12000, 0, 31)).toBe(0);
    expect(prorate(12000, -5, 31)).toBe(0);
  });

  it("always returns a whole amount", () => {
    for (let day = 1; day <= 31; day += 1) {
      expect(isWholeRupees(prorate(12345, day, 31))).toBe(true);
    }
  });

  it("throws on a fractional monthly amount", () => {
    expect(() => prorate(12000.5, 18, 31)).toThrow(/whole number of rupees/);
  });

  it("throws on fractional day counts", () => {
    expect(() => prorate(12000, 18.5, 31)).toThrow(/whole numbers/);
  });

  it("throws on a month with no days", () => {
    expect(() => prorate(12000, 18, 0)).toThrow(/at least one day/);
  });
});

describe("splitAmount", () => {
  // target §9.4: never destroy money. Three ways of 1,000 is 334+333+333.
  it("gives the remainder to the earliest shares rather than losing it", () => {
    expect(splitAmount(1000, 3)).toEqual([334, 333, 333]);
    expect(sumAmounts(splitAmount(1000, 3))).toBe(1000);
  });

  it("splits evenly when it divides", () => {
    expect(splitAmount(12000, 4)).toEqual([3000, 3000, 3000, 3000]);
  });

  it("conserves a negative total too", () => {
    expect(sumAmounts(splitAmount(-1000, 3))).toBe(-1000);
  });

  it("returns the whole amount in one part", () => {
    expect(splitAmount(1000, 1)).toEqual([1000]);
  });

  it("throws on a non-positive part count", () => {
    expect(() => splitAmount(1000, 0)).toThrow(/non-positive/);
  });
});

describe("formatNPR", () => {
  it.each([
    [12000, "NPR 12,000"],
    [0, "NPR 0"],
    [1500, "NPR 1,500"],
    [-3000, "NPR -3,000"],
    [100000, "NPR 100,000"],
  ] as const)("formats %s as %s", (amount, expected) => {
    expect(formatNPR(amount)).toBe(expected);
  });

  // Display is the last place a fraction could hide, so it refuses there too.
  it("throws rather than displaying a fractional amount", () => {
    expect(() => formatNPR(1500.5)).toThrow(/whole number of rupees/);
  });
});
