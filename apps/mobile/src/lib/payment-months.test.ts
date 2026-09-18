import { describe, expect, it } from "vitest";

import type { AdminPeriodRow } from "@/lib/admin-api";
import { claimsForPeriod, monthWindow, paymentMonths } from "@/lib/payment-months";

/**
 * Bhadra, Shrawan and Asar 2083 — the months these cases are about.
 *
 * They used to be `2026-08`, `2026-07`, `2026-06`, carried over from when a
 * period *was* a Gregorian month. That is the reason the strip went on labelling
 * Aswin 2083 as `Jun`: every fixture here was a Gregorian key, so the builder's
 * Gregorian month lookup looked correct in the one place it would have been
 * caught. A period is a BS month, and so is every key below.
 */
const BHADRA = "2083-05";
const SHRAWAN = "2083-04";
const ASAR = "2083-03";

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
        period({ needsAttention: 3, period: BHADRA }),
        period({ needsAttention: 0, period: SHRAWAN }),
        period({ needsAttention: 1, period: ASAR }),
      ],
      { current: BHADRA },
    );

    expect(strip.map((month) => month.period)).toEqual([BHADRA, SHRAWAN, ASAR]);
    // The chip names the month the key *is*. `Aug`, `Jul`, `Jun` here is the
    // defect: a Gregorian name over a Nepali year, naming neither month.
    expect(strip.map((month) => month.label)).toEqual(["Bhadra", "Shrawan", "Asar"]);
    expect(strip.map((month) => month.year)).toEqual(["2083", "2083", "2083"]);
    expect(strip.map((month) => month.isCurrent)).toEqual([true, false, false]);
  });

  it("carries the server's own waiting count rather than deriving one", () => {
    // `total - paid` would say 4 here. The badge and the list must not disagree.
    const [bhadra] = paymentMonths(
      [period({ needsAttention: 3, paid: 6, period: BHADRA, total: 10 })],
      { current: BHADRA },
    );

    expect(bhadra.waiting).toBe(3);
  });

  it("trims to the months somebody would actually scroll to", () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      period({ period: `2083-${String((index % 12) + 1).padStart(2, "0")}` }),
    );

    expect(paymentMonths(rows, { current: BHADRA })).toHaveLength(12);
    expect(paymentMonths(rows, { current: BHADRA, limit: 3 })).toHaveLength(3);
  });

  it("drops a period it cannot name instead of drawing a chip labelled nothing", () => {
    const strip = paymentMonths(
      [
        period({ period: BHADRA }),
        period({ period: "not-a-period" }),
        period({ period: "2083-13" }),
      ],
      { current: BHADRA },
    );

    expect(strip.map((month) => month.period)).toEqual([BHADRA]);
  });
});

describe("monthWindow", () => {
  it("puts this month first, then the months ahead, then the months behind", () => {
    const strip = monthWindow({ back: 2, current: BHADRA, forward: 2 });

    // Aswin at the *head* of the strip during Aswin is the bug this ordering
    // exists to prevent: it was the same month name as the one the reader meant,
    // a year away, and a discount set on "this month" landed on it.
    expect(strip.map((month) => month.period)).toEqual([
      BHADRA,
      "2083-06",
      "2083-07",
      SHRAWAN,
      ASAR,
    ]);
    expect(strip.map((month) => month.label)).toEqual([
      "Bhadra",
      "Aswin",
      "Kartik",
      "Shrawan",
      "Asar",
    ]);
  });

  it("lights only the month the phone is standing in", () => {
    const strip = monthWindow({ back: 1, current: BHADRA, forward: 1 });

    expect(strip.filter((month) => month.isCurrent).map((month) => month.period)).toEqual([
      BHADRA,
    ]);
  });

  it("crosses the year boundary by the calendar, not by adding one to the key", () => {
    // Chaitra is the twelfth BS month, so the month after it is Baisakh of the
    // next year — `2083-13` is not a month and a string bump would produce it.
    const [, next] = monthWindow({ back: 0, current: "2083-12", forward: 1 });

    expect(next.period).toBe("2084-01");
    expect(next.label).toBe("Baisakh");
    expect(next.year).toBe("2084");
  });

  it("carries no badge, because it has no invoice data to count", () => {
    expect(
      monthWindow({ back: 1, current: BHADRA, forward: 1 }).every(
        (month) => month.waiting === 0,
      ),
    ).toBe(true);
  });
});

describe("claimsForPeriod", () => {
  const claims = [
    { id: "bhadra", period: BHADRA },
    { id: "shrawan", period: SHRAWAN },
    { id: "admission-fee", period: null },
  ];

  it("scopes claims to the month on screen", () => {
    expect(
      claimsForPeriod(claims, SHRAWAN, { current: BHADRA }).map((claim) => claim.id),
    ).toEqual(["shrawan"]);
  });

  it("surfaces a period-less claim on the current month, so it is reviewable somewhere", () => {
    // An admission fee is stored with `period: null`. A strict period match
    // hides the first claim a new resident ever files, in every month.
    expect(
      claimsForPeriod(claims, BHADRA, { current: BHADRA }).map((claim) => claim.id),
    ).toEqual(["bhadra", "admission-fee"]);
  });

  it("does not repeat that claim under every month in the strip", () => {
    expect(
      claimsForPeriod(claims, ASAR, { current: BHADRA }).map((claim) => claim.id),
    ).toEqual([]);
  });
});
