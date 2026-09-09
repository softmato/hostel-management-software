import { describe, expect, it } from "vitest";

import {
  formatPaisa,
  paisaToRupees,
  rupeesToPaisa,
} from "@/modules/billing/softmato/money";

/**
 * The hundred-fold gap between our rupees and Softmato's paisa.
 *
 * What is worth pinning is the asymmetry: one direction is total and the other
 * is not, and the file refuses rather than rounds. A `Math.round` here is how a
 * ledger ends up a rupee out with nothing recording which side moved.
 */

describe("rupees to paisa", () => {
  it("converts exactly", () => {
    expect(rupeesToPaisa(5_000)).toBe(500_000);
    expect(rupeesToPaisa(20_000)).toBe(2_000_000);
  });

  it("refuses a fraction rather than silently rounding it", () => {
    expect(() => rupeesToPaisa(99.5)).toThrow(/whole rupees/);
  });
});

describe("paisa to rupees", () => {
  it("converts a whole-rupee amount", () => {
    expect(paisaToRupees(1_200_000)).toBe(12_000);
  });

  it("refuses an amount our schema cannot hold", () => {
    /*
     * A provider fee or a partial refund is under no obligation to land on a
     * rupee boundary. Every subscription amount field is a validated integer,
     * so there is nowhere to put 1,234.56 — and rounding it would be inventing
     * a figure nobody agreed to.
     */
    expect(() => paisaToRupees(123_456)).toThrow(/not a whole number of rupees/);
  });
});

describe("displaying paisa", () => {
  it("keeps both decimal places", () => {
    expect(formatPaisa(123_456)).toBe("1,234.56");
    expect(formatPaisa(500_000)).toBe("5,000.00");
  });
});
