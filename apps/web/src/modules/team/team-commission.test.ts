import { describe, expect, it } from "vitest";

import { commissionFor } from "@/modules/team/team-commission.service";

describe("commissionFor", () => {
  it("works a percent of the plan out to the paisa", () => {
    expect(commissionFor(4900, 11.12)).toBe(544.88);
    expect(commissionFor(12000, 11.12)).toBe(1334.4);
    expect(commissionFor(999, 11.12)).toBe(111.09);
  });

  it("earns nothing at a zero rate or a free plan", () => {
    expect(commissionFor(4900, 0)).toBe(0);
    expect(commissionFor(0, 11.12)).toBe(0);
  });
});
