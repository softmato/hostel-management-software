/**
 * The supply store's pure helpers.
 *
 * Its own module, away from `store-api.ts`, for the reason `constants/topics.ts`
 * gives: `store-api.ts` imports the axios client, and Vitest here is node-side
 * with no React Native shim, so anything that has to be tested cannot live
 * beside it.
 *
 * ## Everything the API sends is paisa
 *
 * `StoreProduct.price`, every line total, every order total. The app's own
 * `<Money>` and `formatMoney` take **rupees**, so exactly one function converts
 * — {@link rupees} — and it is the only place in the store screens where a
 * hundred appears. A second `/ 100` anywhere is how a cart shows one number and
 * a checkout shows another.
 */

import type { BadgeTone } from "@/lib/status";

/** Paisa to rupees, for `<Money value={…} />` and `formatMoney`. */
export function rupees(paisa: number | null | undefined): number | null {
  if (paisa === null || paisa === undefined || !Number.isFinite(paisa)) {
    return null;
  }

  return paisa / 100;
}

/**
 * What the stepper on a cart row is allowed to do next.
 *
 * Returns both bounds rather than a pair of booleans, because the row also has
 * to *show* the ceiling when it is the reason the plus button is dead — "only 3
 * left" is the difference between a broken control and an informative one.
 *
 * `stockQuantity` is `null` for a product that does not track stock, and
 * `maxOrderQuantity` is `0` for "no cap" — both are the server's vocabulary,
 * mirrored here rather than translated, so a change on one side is visible as a
 * change on the other.
 */
export function stepperBounds(product: {
  maxOrderQuantity: number;
  minOrderQuantity: number;
  stockQuantity: number | null;
}) {
  const ceilings: number[] = [];

  if (product.maxOrderQuantity > 0) {
    ceilings.push(product.maxOrderQuantity);
  }

  if (product.stockQuantity !== null) {
    ceilings.push(product.stockQuantity);
  }

  return {
    max: ceilings.length > 0 ? Math.min(...ceilings) : Number.POSITIVE_INFINITY,
    min: Math.max(product.minOrderQuantity, 1),
  };
}

/**
 * The one line under a cart row that explains a stuck stepper, or `null` when
 * there is nothing to explain.
 *
 * Deliberately silent in the ordinary case. A row that always carries a caption
 * teaches people to stop reading captions, which is precisely when the one that
 * matters — "only 2 left" on the thing they are about to order twelve of —
 * stops being read.
 */
export function limitNote(
  limitedBy: "max" | "stock" | null,
  bounds: { max: number },
): string | null {
  if (limitedBy === "stock") {
    return bounds.max === 0 ? "Out of stock" : `Only ${bounds.max} left`;
  }

  if (limitedBy === "max") {
    return `${bounds.max} per order`;
  }

  return null;
}

/**
 * "NPR 1,240 more for free delivery", or `null` once it is earned.
 *
 * The threshold rule itself lives on the server — see `store-pricing.ts` — and
 * this only phrases the number the server already worked out. Recomputing it
 * here would be a second copy of a commercial rule that the platform owner can
 * change from a form.
 */
export function freeDeliveryNote(totals: {
  freeDeliveryRemaining: number;
  hasFreeDelivery: boolean;
}): string | null {
  if (totals.hasFreeDelivery) {
    return "Delivery is free on this order";
  }

  if (totals.freeDeliveryRemaining <= 0) {
    return null;
  }

  return `NPR ${Math.ceil(totals.freeDeliveryRemaining / 100).toLocaleString("en-NP")} more for free delivery`;
}

/**
 * How far along the free-delivery bar is, 0–1.
 *
 * `0` when the rule is off, so the bar can be hidden on one test rather than on
 * a combination of three fields. Never above 1 — an order well past the
 * threshold still draws a full bar, not an overflowing one.
 */
export function freeDeliveryProgress(totals: {
  freeDeliveryRemaining: number;
  hasFreeDelivery: boolean;
  subtotal: number;
}): number {
  if (totals.hasFreeDelivery) {
    return 1;
  }

  const threshold = totals.subtotal + totals.freeDeliveryRemaining;

  if (threshold <= 0 || totals.freeDeliveryRemaining <= 0) {
    return 0;
  }

  return Math.min(totals.subtotal / threshold, 1);
}

/** Percentage off, for the badge on a discounted card. `null` when there is none. */
export function discountPercent(price: number, compareAtPrice: number | null): number | null {
  if (!compareAtPrice || compareAtPrice <= price) {
    return null;
  }

  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
}

/**
 * The tone a `<Badge>` takes for an order's status.
 *
 * Not `statusTone` from `lib/status.ts`: that table is keyed on the payment and
 * complaint vocabularies, and `PLACED`/`PACKED`/`SHIPPED` fall through it to
 * `neutral` — five statuses rendered as one grey pill. This is the store's own
 * mapping and stays here rather than growing the shared table, because
 * `DELIVERED` meaning *good* is a fact about orders, not about the app.
 */
export function orderTone(status: string): BadgeTone {
  switch (status) {
    case "CANCELLED":
      return "danger";
    case "DELIVERED":
      return "success";
    case "SHIPPED":
      return "info";
    case "PLACED":
      return "warning";
    default:
      return "neutral";
  }
}
