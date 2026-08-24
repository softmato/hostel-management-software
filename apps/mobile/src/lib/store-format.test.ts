/**
 * The store's pure helpers.
 *
 * The cases worth pinning are the ones where the server's vocabulary is easy to
 * misread on the client: `stockQuantity: null` meaning "not tracked" rather than
 * "none left", and `maxOrderQuantity: 0` meaning "no cap" rather than "cannot
 * order any". Getting either backwards produces a stepper that refuses to move
 * and looks broken rather than restricted.
 */
import { describe, expect, it } from "vitest";

import {
  discountPercent,
  freeDeliveryNote,
  freeDeliveryProgress,
  limitNote,
  orderTone,
  rupees,
  stepperBounds,
} from "@/lib/store-format";

describe("rupees", () => {
  it("divides paisa by a hundred", () => {
    expect(rupees(1_250_00)).toBe(1250);
    expect(rupees(99)).toBe(0.99);
  });

  it("keeps zero as zero, not as absent", () => {
    // `<Money>` prints a dash for null. A free line is NPR 0, not "—".
    expect(rupees(0)).toBe(0);
  });

  it("passes nothing through as nothing", () => {
    expect(rupees(null)).toBeNull();
    expect(rupees(undefined)).toBeNull();
    expect(rupees(Number.NaN)).toBeNull();
  });
});

describe("stepperBounds", () => {
  it("has no ceiling when nothing constrains it", () => {
    expect(
      stepperBounds({ maxOrderQuantity: 0, minOrderQuantity: 1, stockQuantity: null }),
    ).toEqual({ max: Number.POSITIVE_INFINITY, min: 1 });
  });

  it("reads a zero maximum as 'no cap', never as zero", () => {
    const bounds = stepperBounds({
      maxOrderQuantity: 0,
      minOrderQuantity: 1,
      stockQuantity: 12,
    });

    expect(bounds.max).toBe(12);
  });

  it("reads a null stock as 'not tracked', never as none left", () => {
    const bounds = stepperBounds({
      maxOrderQuantity: 5,
      minOrderQuantity: 1,
      stockQuantity: null,
    });

    expect(bounds.max).toBe(5);
  });

  it("takes the lower of stock and the per-order cap", () => {
    expect(
      stepperBounds({ maxOrderQuantity: 10, minOrderQuantity: 1, stockQuantity: 3 }).max,
    ).toBe(3);

    expect(
      stepperBounds({ maxOrderQuantity: 2, minOrderQuantity: 1, stockQuantity: 30 }).max,
    ).toBe(2);
  });

  it("never lets the floor drop below one", () => {
    expect(
      stepperBounds({ maxOrderQuantity: 0, minOrderQuantity: 0, stockQuantity: null }).min,
    ).toBe(1);
  });
});

describe("limitNote", () => {
  it("says nothing when nothing is limiting the row", () => {
    expect(limitNote(null, { max: 10 })).toBeNull();
  });

  it("names the stock left", () => {
    expect(limitNote("stock", { max: 2 })).toBe("Only 2 left");
  });

  it("says out of stock rather than 'only 0 left'", () => {
    expect(limitNote("stock", { max: 0 })).toBe("Out of stock");
  });

  it("names the per-order cap", () => {
    expect(limitNote("max", { max: 5 })).toBe("5 per order");
  });
});

describe("freeDeliveryNote", () => {
  it("celebrates only once it is actually earned", () => {
    expect(
      freeDeliveryNote({ freeDeliveryRemaining: 0, hasFreeDelivery: true }),
    ).toBe("Delivery is free on this order");
  });

  it("says how much more is needed", () => {
    expect(
      freeDeliveryNote({ freeDeliveryRemaining: 1_240_00, hasFreeDelivery: false }),
    ).toContain("1,240");
  });

  it("says nothing at all when the rule is switched off", () => {
    expect(
      freeDeliveryNote({ freeDeliveryRemaining: 0, hasFreeDelivery: false }),
    ).toBeNull();
  });
});

describe("freeDeliveryProgress", () => {
  it("is full once delivery is free", () => {
    expect(
      freeDeliveryProgress({
        freeDeliveryRemaining: 0,
        hasFreeDelivery: true,
        subtotal: 9_000_00,
      }),
    ).toBe(1);
  });

  it("is the fraction of the way there", () => {
    expect(
      freeDeliveryProgress({
        freeDeliveryRemaining: 2_500_00,
        hasFreeDelivery: false,
        subtotal: 2_500_00,
      }),
    ).toBe(0.5);
  });

  it("is zero when the rule is off, so the bar can hide on one test", () => {
    expect(
      freeDeliveryProgress({
        freeDeliveryRemaining: 0,
        hasFreeDelivery: false,
        subtotal: 400_00,
      }),
    ).toBe(0);
  });

  it("never overflows past one", () => {
    expect(
      freeDeliveryProgress({
        freeDeliveryRemaining: 0,
        hasFreeDelivery: true,
        subtotal: 50_000_00,
      }),
    ).toBeLessThanOrEqual(1);
  });
});

describe("discountPercent", () => {
  it("rounds to a whole percentage", () => {
    expect(discountPercent(59_99, 89_99)).toBe(33);
  });

  it("shows nothing when there is no saving to show", () => {
    expect(discountPercent(100_00, null)).toBeNull();
    expect(discountPercent(100_00, 100_00)).toBeNull();
    expect(discountPercent(100_00, 90_00)).toBeNull();
  });
});

describe("orderTone", () => {
  it("colours the ends of the lifecycle and leaves the middle quiet", () => {
    expect(orderTone("DELIVERED")).toBe("success");
    expect(orderTone("CANCELLED")).toBe("danger");
    expect(orderTone("SHIPPED")).toBe("info");
    expect(orderTone("PLACED")).toBe("warning");
    expect(orderTone("CONFIRMED")).toBe("neutral");
    expect(orderTone("PACKED")).toBe("neutral");
  });
});
