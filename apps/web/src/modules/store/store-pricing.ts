import type { StoreConfig } from "@/modules/store/store-config";

/**
 * What a basket costs, as pure arithmetic.
 *
 * Split out of the cart and order services because both have to produce the
 * *same* number and they reach it from different places — the cart quotes it
 * live from the catalogue, the order computes it once and writes it down. Two
 * implementations of one total is the bug where a hostel is shown NPR 4,850 and
 * charged NPR 5,000, and it has tests here rather than an integration test that
 * has to stand a database up to find it.
 *
 * ## Integers, all the way down
 *
 * Every figure is **NPR paisa**. `unitPrice * quantity` on integers is exact;
 * the same expression on rupees-as-float is not, and a 37-line order is enough
 * for the drift to show up in the last digit. Nothing here divides.
 */

export type PricedLine = {
  quantity: number;
  unitPrice: number;
};

export type CartTotals = {
  /** `subtotal + deliveryFee`. Written out so callers never re-add it. */
  total: number;
  deliveryFee: number;
  /**
   * How much more this basket needs for free delivery, or `0` when it already
   * qualifies or the rule is off. This is the progress bar in the reference
   * cart screen, and it is computed here so the phone does no money arithmetic.
   */
  freeDeliveryRemaining: number;
  /** True when the order ships free — either by threshold or a zero fee. */
  hasFreeDelivery: boolean;
  itemCount: number;
  subtotal: number;
};

export function lineTotal(line: PricedLine) {
  return line.unitPrice * line.quantity;
}

/**
 * `freeDeliveryThreshold === 0` disables the rule rather than making everything
 * free — see the field's own note. A subtotal of zero (an empty basket) also
 * never qualifies: quoting "free delivery unlocked" on nothing is how a cart
 * screen ends up cheering an empty state.
 */
export function qualifiesForFreeDelivery(subtotal: number, config: StoreConfig) {
  return (
    subtotal > 0 &&
    config.freeDeliveryThreshold > 0 &&
    subtotal >= config.freeDeliveryThreshold
  );
}

export function cartTotals(lines: readonly PricedLine[], config: StoreConfig): CartTotals {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  /*
   * An empty basket costs nothing, delivery included. Charging a delivery fee on
   * zero items is arithmetically defensible and reads as a bug on screen — the
   * cart would show "NPR 150" under the words "Your cart is empty".
   */
  if (subtotal === 0) {
    return {
      deliveryFee: 0,
      freeDeliveryRemaining: 0,
      hasFreeDelivery: false,
      itemCount: 0,
      subtotal: 0,
      total: 0,
    };
  }

  const free = qualifiesForFreeDelivery(subtotal, config);
  const deliveryFee = free ? 0 : config.deliveryFee;

  return {
    deliveryFee,
    freeDeliveryRemaining:
      free || config.freeDeliveryThreshold === 0
        ? 0
        : Math.max(config.freeDeliveryThreshold - subtotal, 0),
    hasFreeDelivery: deliveryFee === 0,
    itemCount,
    subtotal,
    total: subtotal + deliveryFee,
  };
}

/**
 * Clamps a requested quantity to what the product allows.
 *
 * Returns the number **and** why it changed, because a stepper that silently
 * stops at 5 with no explanation reads as broken input handling. The caller
 * turns `reason` into the line under the row.
 */
export function clampQuantity(
  requested: number,
  bounds: {
    /** `0` means no ceiling — see `StoreProduct.maxOrderQuantity`. */
    maxOrderQuantity: number;
    minOrderQuantity: number;
    /** `null` when the product does not track stock. */
    stockQuantity: number | null;
  },
): { quantity: number; reason: "max" | "none" | "stock" } {
  const ceilings: { kind: "max" | "stock"; value: number }[] = [];

  if (bounds.maxOrderQuantity > 0) {
    ceilings.push({ kind: "max", value: bounds.maxOrderQuantity });
  }

  if (bounds.stockQuantity !== null) {
    ceilings.push({ kind: "stock", value: bounds.stockQuantity });
  }

  const floor = Math.max(bounds.minOrderQuantity, 1);
  let quantity = Math.max(requested, floor);
  let reason: "max" | "none" | "stock" = "none";

  for (const ceiling of ceilings) {
    if (quantity > ceiling.value) {
      quantity = ceiling.value;
      reason = ceiling.kind;
    }
  }

  /*
   * A product whose stock has fallen below its own minimum order quantity
   * cannot be bought at all, and the floor above would otherwise raise the
   * quantity back over the stock it just clamped to. Zero is the honest answer;
   * the caller reads it as "out of stock".
   */
  return { quantity: Math.max(quantity, 0), reason };
}
