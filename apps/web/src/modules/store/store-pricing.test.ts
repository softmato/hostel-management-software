/**
 * What a basket costs.
 *
 * These are the numbers a hostel is charged, so the cases here are the ones
 * where a plausible implementation gets it *nearly* right: the empty basket
 * that still quotes a delivery fee, the threshold rule that turns "free over
 * NPR 5,000" into "free always" when the threshold is zero, and the clamp that
 * has to survive a stock level below the product's own minimum order.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_STORE_CONFIG, type StoreConfig } from "@/modules/store/store-config";
import {
  cartTotals,
  clampQuantity,
  lineTotal,
  qualifiesForFreeDelivery,
} from "@/modules/store/store-pricing";

function config(overrides: Partial<StoreConfig> = {}): StoreConfig {
  return { ...DEFAULT_STORE_CONFIG, ...overrides };
}

/** NPR 150 delivery, free over NPR 5,000 — the shipped defaults, in paisa. */
const BASE = config({ deliveryFee: 150_00, freeDeliveryThreshold: 5_000_00 });

describe("lineTotal", () => {
  it("multiplies paisa by quantity", () => {
    expect(lineTotal({ quantity: 3, unitPrice: 1_250_00 })).toBe(3_750_00);
  });

  it("stays exact over a long basket, where floating rupees would not", () => {
    // 37 x NPR 10.10. In rupees-as-float this lands on 373.70000000000005.
    const lines = Array.from({ length: 37 }, () => ({ quantity: 1, unitPrice: 10_10 }));
    const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);

    expect(total).toBe(373_70);
    expect(Number.isInteger(total)).toBe(true);
  });
});

describe("cartTotals", () => {
  it("adds the delivery fee below the threshold", () => {
    const totals = cartTotals([{ quantity: 2, unitPrice: 500_00 }], BASE);

    expect(totals.subtotal).toBe(1_000_00);
    expect(totals.deliveryFee).toBe(150_00);
    expect(totals.total).toBe(1_150_00);
    expect(totals.hasFreeDelivery).toBe(false);
  });

  it("drops the fee at the threshold, not one paisa past it", () => {
    const totals = cartTotals([{ quantity: 1, unitPrice: 5_000_00 }], BASE);

    expect(totals.deliveryFee).toBe(0);
    expect(totals.hasFreeDelivery).toBe(true);
    expect(totals.total).toBe(5_000_00);
    expect(totals.freeDeliveryRemaining).toBe(0);
  });

  it("reports how much more the basket needs, for the progress bar", () => {
    const totals = cartTotals([{ quantity: 1, unitPrice: 4_000_00 }], BASE);

    expect(totals.freeDeliveryRemaining).toBe(1_000_00);
  });

  it("charges nothing at all on an empty basket, delivery included", () => {
    const totals = cartTotals([], BASE);

    expect(totals).toEqual({
      deliveryFee: 0,
      freeDeliveryRemaining: 0,
      hasFreeDelivery: false,
      itemCount: 0,
      subtotal: 0,
      total: 0,
    });
  });

  it("counts units, not lines", () => {
    const totals = cartTotals(
      [
        { quantity: 3, unitPrice: 100_00 },
        { quantity: 2, unitPrice: 50_00 },
      ],
      BASE,
    );

    expect(totals.itemCount).toBe(5);
  });

  it("treats a zero threshold as 'the rule is off', never as 'always free'", () => {
    const totals = cartTotals(
      [{ quantity: 1, unitPrice: 50_000_00 }],
      config({ deliveryFee: 150_00, freeDeliveryThreshold: 0 }),
    );

    expect(totals.deliveryFee).toBe(150_00);
    expect(totals.freeDeliveryRemaining).toBe(0);
  });

  it("reports free delivery when the fee itself is zero", () => {
    const totals = cartTotals(
      [{ quantity: 1, unitPrice: 100_00 }],
      config({ deliveryFee: 0, freeDeliveryThreshold: 5_000_00 }),
    );

    expect(totals.hasFreeDelivery).toBe(true);
    expect(totals.total).toBe(100_00);
  });
});

describe("qualifiesForFreeDelivery", () => {
  it("never cheers an empty basket", () => {
    expect(qualifiesForFreeDelivery(0, config({ freeDeliveryThreshold: 0 }))).toBe(false);
    expect(qualifiesForFreeDelivery(0, BASE)).toBe(false);
  });
});

describe("clampQuantity", () => {
  const unlimited = { maxOrderQuantity: 0, minOrderQuantity: 1, stockQuantity: null };

  it("passes a quantity that breaks no rule", () => {
    expect(clampQuantity(4, unlimited)).toEqual({ quantity: 4, reason: "none" });
  });

  it("raises to the product's minimum", () => {
    expect(clampQuantity(1, { ...unlimited, minOrderQuantity: 5 })).toEqual({
      quantity: 5,
      reason: "none",
    });
  });

  it("caps at the per-order maximum and says so", () => {
    expect(clampQuantity(50, { ...unlimited, maxOrderQuantity: 10 })).toEqual({
      quantity: 10,
      reason: "max",
    });
  });

  it("caps at stock and says so", () => {
    expect(clampQuantity(50, { ...unlimited, stockQuantity: 3 })).toEqual({
      quantity: 3,
      reason: "stock",
    });
  });

  it("lets stock win over the per-order maximum when it is lower", () => {
    expect(
      clampQuantity(50, { maxOrderQuantity: 10, minOrderQuantity: 1, stockQuantity: 3 }),
    ).toEqual({ quantity: 3, reason: "stock" });
  });

  it("ignores stock entirely when the product does not track it", () => {
    expect(clampQuantity(500, unlimited)).toEqual({ quantity: 500, reason: "none" });
  });

  it("returns zero when stock has fallen below the minimum order", () => {
    // The floor must not raise this back above the stock it just clamped to.
    expect(
      clampQuantity(1, { maxOrderQuantity: 0, minOrderQuantity: 5, stockQuantity: 2 }),
    ).toEqual({ quantity: 2, reason: "stock" });

    expect(
      clampQuantity(1, { maxOrderQuantity: 0, minOrderQuantity: 5, stockQuantity: 0 }),
    ).toEqual({ quantity: 0, reason: "stock" });
  });
});
