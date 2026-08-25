/**
 * What the catalogue screen and the product form both need to agree on.
 *
 * Its own module rather than exports off `platform-store-page.tsx`, because the
 * form imports from here and the page imports the form — types and helpers
 * living on the page would make that a cycle.
 *
 * ## Prices cross the wire in paisa and are typed in rupees
 *
 * The conversion lives in exactly these two functions and nowhere else, which is
 * the whole reason the API took an integer in the first place — see
 * `store.validation.ts`. A second `* 100` anywhere in the store's admin screens
 * is a bug waiting for a rounding case.
 */

export function toRupees(paisa: number) {
  return paisa / 100;
}

export function toPaisa(rupees: number) {
  return Math.round(rupees * 100);
}

export function formatPaisa(paisa: number) {
  return new Intl.NumberFormat("en-NP", {
    currency: "NPR",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(toRupees(paisa));
}

export type StoreCategory = {
  icon: string;
  id: string;
  imageAssetId: string;
  imageUrl: string;
  isActive: boolean;
  name: string;
  priority: number;
  productCount: number;
  slug: string;
};

export type StoreProduct = {
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  compareAtPrice: number | null;
  description: string;
  id: string;
  images: { assetId: string; url: string }[];
  inStock: boolean;
  isActive: boolean;
  isFeatured: boolean;
  maxOrderQuantity: number;
  minOrderQuantity: number;
  name: string;
  price: number;
  slug: string;
  stockOnHand: number;
  summary: string;
  tags: string[];
  trackStock: boolean;
  unit: string;
};

/**
 * A name typed into the form becomes a URL handle when the slug field is blank.
 * Only ever a *default* — an existing product keeps whatever slug it shipped
 * with, because the phone and any shared link filter by it.
 */
export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

/** Percentage off, for the badge the shop draws. `null` when there is no offer. */
export function discountPercent(price: number, compareAtPrice: number | null) {
  if (!compareAtPrice || compareAtPrice <= price) {
    return null;
  }

  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
}
