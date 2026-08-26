import { describe, expect, it } from "vitest";

import type { AdminPeriodRow } from "@/lib/admin-api";
import { claimsForPeriod, paymentMonths } from "@/lib/payment-months";

function period(overrides: Partial<AdminPeriodRow> & { period: string }): AdminPeriodRow {
  return {
    collected: 0,
    due: 0,
    needsAttention: 0,
    paid: 0,
    total: 0,
    ...overrides,
  };
}

describe("paymentMonths", () => {
  it("keeps the server's order and marks the month the phone is standing in", () => {
    const strip = paymentMonths(
      [
        period({ needsAttention: 3, period: "2026-08" }),
        period({ needsAttention: 0, period: "2026-07" }),
        period({ needsAttention: 1, period: "2026-06" }),
      ],
      { current: "2026-08" },
    );

    expect(strip.map((month) => month.period)).toEqual(["2026-08", "2026-07", "2026-06"]);
    expect(strip.map((month) => month.label)).toEqual(["Aug", "Jul", "Jun"]);
    expect(strip.map((month) => month.isCurrent)).toEqual([true, false, false]);
  });

  it("carries the server's own waiting count rather than deriving one", () => {
    // `total - paid` would say 4 here. The badge and the list must not disagree.
    const [august] = paymentMonths(
      [period({ needsAttention: 3, paid: 6, period: "2026-08", total: 10 })],
      { current: "2026-08" },
    );

    expect(august.waiting).toBe(3);
  });

  it("trims to the months somebody would actually scroll to", () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      period({ period: `2026-${String((index % 12) + 1).padStart(2, "0")}` }),
    );

    expect(paymentMonths(rows, { current: "2026-08" })).toHaveLength(12);
    expect(paymentMonths(rows, { current: "2026-08", limit: 3 })).toHaveLength(3);
  });

  it("drops a period it cannot name instead of drawing a chip labelled nothing", () => {
    const strip = paymentMonths(
      [
        period({ period: "2026-08" }),
        period({ period: "not-a-period" }),
        period({ period: "2026-13" }),
      ],
      { current: "2026-08" },
    );

    expect(strip.map((month) => month.period)).toEqual(["2026-08"]);
  });
});

describe("claimsForPeriod", () => {
  const claims = [
    { id: "august", period: "2026-08" },
    { id: "july", period: "2026-07" },
    { id: "admission-fee", period: null },
  ];

  it("scopes claims to the month on screen", () => {
    expect(
      claimsForPeriod(claims, "2026-07", { current: "2026-08" }).map((claim) => claim.id),
    ).toEqual(["july"]);
  });

  it("surfaces a period-less claim on the current month, so it is reviewable somewhere", () => {
    // An admission fee is stored with `period: null`. A strict period match
    // hides the first claim a new resident ever files, in every month.
    expect(
      claimsForPeriod(claims, "2026-08", { current: "2026-08" }).map((claim) => claim.id),
    ).toEqual(["august", "admission-fee"]);
  });

  it("does not repeat that claim under every month in the strip", () => {
    expect(
      claimsForPeriod(claims, "2026-06", { current: "2026-08" }).map((claim) => claim.id),
    ).toEqual([]);
  });
});
