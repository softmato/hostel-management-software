import { describe, expect, it } from "vitest";

import type { PublicHostel } from "@/app/_components/public-hostel-data";

import { parseBudgetRange, topHostelMatches } from "./hostel-recommendation";

function makeHostel(overrides: Partial<PublicHostel> & { id: string }): PublicHostel {
  return {
    facilities: [],
    hostelType: "CO_LIVING",
    location: { area: "Baneshwor" },
    name: overrides.id,
    photos: [],
    roomTypes: [],
    rules: [],
    slug: overrides.id,
    verificationStatus: "VERIFIED",
    ...overrides,
  };
}

describe("parseBudgetRange", () => {
  it("reads a plain min-max range", () => {
    expect(parseBudgetRange("8000-12000")).toEqual({ max: 12000, min: 8000 });
  });

  it("reads a shorthand range", () => {
    expect(parseBudgetRange("8k-12k")).toEqual({ max: 12000, min: 8000 });
  });

  it("treats a single figure as a ceiling with headroom below it", () => {
    expect(parseBudgetRange("10000")).toEqual({ max: 10000, min: 6000 });
  });

  it("returns null for empty or unparseable input", () => {
    expect(parseBudgetRange("")).toBeNull();
    expect(parseBudgetRange(undefined)).toBeNull();
    expect(parseBudgetRange(null)).toBeNull();
    expect(parseBudgetRange("flexible")).toBeNull();
  });
});

describe("topHostelMatches", () => {
  const PULCHOWK = "IOE Pulchowk Campus";

  it("returns nothing without a request", () => {
    expect(topHostelMatches([makeHostel({ id: "a" })], null)).toEqual([]);
  });

  it("ranks the hostel that fits the budget and sits near the preferred college first", () => {
    const nearAndAffordable = makeHostel({
      coordinates: { lat: 27.682, lng: 85.3175 }, // same point as Pulchowk
      id: "near-affordable",
      pricing: { monthlyRentMax: 9000, monthlyRentMin: 8000 },
    });
    const farAndExpensive = makeHostel({
      coordinates: { lat: 27.9, lng: 85.9 },
      id: "far-expensive",
      pricing: { monthlyRentMax: 25000, monthlyRentMin: 20000 },
    });

    const matches = topHostelMatches(
      [farAndExpensive, nearAndAffordable],
      { budgetRange: "8000-12000", preferredCollege: PULCHOWK },
    );

    expect(matches[0]?.hostel.id).toBe("near-affordable");
    expect(matches[0]?.withinBudget).toBe(true);
    expect(matches[0]?.distanceKm).toBeCloseTo(0, 1);

    const far = matches.find((match) => match.hostel.id === "far-expensive");
    expect(far?.withinBudget).toBe(false);
  });

  it("caps results at the given limit", () => {
    const hostels = Array.from({ length: 5 }, (_, index) => makeHostel({ id: `h${index}` }));

    expect(topHostelMatches(hostels, { budgetRange: null, preferredCollege: null }, 3)).toHaveLength(3);
  });
});
