import { describe, expect, it } from "vitest";

import { maintenanceSettingsSchema } from "@/modules/maintenance/maintenance.validation";

/**
 * The call-out charge rules, as validation.
 *
 * The service that stores these is a one-line `$set`; what is actually worth
 * asserting is the shape it refuses, because each refusal here is a way a hostel
 * could otherwise end up quoting a number nobody agreed to.
 */
describe("maintenanceSettingsSchema", () => {
  it("takes a list of trades and their agreed floors", () => {
    const result = maintenanceSettingsSchema.parse({
      minimumCharges: [
        { amount: 800, category: "PLUMBING" },
        { amount: 1200, category: "ELECTRICAL" },
      ],
    });

    expect(result.minimumCharges).toHaveLength(2);
  });

  it("refuses two charges for the same trade", () => {
    // Last-write-wins would leave a hostel quoting whichever row the array
    // happened to order first, which is a form bug nobody would ever see.
    expect(() =>
      maintenanceSettingsSchema.parse({
        minimumCharges: [
          { amount: 800, category: "PLUMBING" },
          { amount: 950, category: "PLUMBING" },
        ],
      }),
    ).toThrow(/only one minimum charge/i);
  });

  it("refuses paisa — every amount in the product is whole rupees", () => {
    expect(() =>
      maintenanceSettingsSchema.parse({
        minimumCharges: [{ amount: 800.5, category: "PLUMBING" }],
      }),
    ).toThrow();
  });

  it("refuses a negative charge and a trade nobody defined", () => {
    expect(() =>
      maintenanceSettingsSchema.parse({
        minimumCharges: [{ amount: -1, category: "PLUMBING" }],
      }),
    ).toThrow();

    expect(() =>
      maintenanceSettingsSchema.parse({
        minimumCharges: [{ amount: 500, category: "TELEPATHY" }],
      }),
    ).toThrow();
  });

  it("accepts an empty list, which is how a rate is removed", () => {
    // There is no delete route. Leaving a category out of the list is the only
    // way to say "we no longer have an agreed rate for this", so an empty array
    // has to be a legal body rather than a suspicious one.
    expect(maintenanceSettingsSchema.parse({ minimumCharges: [] })).toEqual({
      minimumCharges: [],
    });
  });
});
