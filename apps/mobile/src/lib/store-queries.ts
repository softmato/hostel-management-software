import { REALTIME_TOPIC } from "@/constants/topics";
import {
  type CartResult,
  type StoreCheckout,
  type StoreHome,
  type StoreOrder,
  type StoreOrderPage,
  type StoreProduct,
  type StoreProductPage,
  type StoreProductQuery,
  type StoreShelf,
  getCart,
  getCheckout,
  getStoreHome,
  getStoreOrder,
  getStoreProduct,
  getStoreShelves,
  listStoreOrders,
  listStoreProducts,
} from "@/lib/store-api";
import { defineQuery, type Query } from "@/lib/query-cache";

/**
 * Every read the store makes, named once.
 *
 * The sibling of `cook-queries.ts` and `community-queries.ts`, and the store had
 * the plainest version of the problem they exist to fix: **not one store screen
 * passed a `cacheKey`.** `useResource` without a key keeps its payload in
 * component state, so the catalogue was refetched from scratch — with a full
 * spinner — on every mount, on a product grid that has no `hostelId` and changes
 * about as often as a printed price list.
 *
 * Two reads are shared rather than merely repeated, which is the other half of
 * the point: `getCart` is called by both the cart screen and the header's cart
 * badge, and `listStoreProducts` by the shop front and the category page. One
 * key each means one request and one answer, not a race between two.
 *
 * ## One topic
 *
 * `store.service.ts` publishes `store` for the catalogue and for a cart or order
 * moving, so an entry here goes stale when any of them does. Coarse on purpose:
 * a price change genuinely does change what a cart line is worth.
 *
 * ## Free-text search is deliberately absent
 *
 * The search box on the shop front and the category page keeps its uncached
 * loader. A key per keystroke would fill the cache — and the disk it persists to
 * — with answers to questions nobody will ask twice, evicting the catalogue that
 * is the whole reason this file exists.
 */

export type StoreQuery<T> = Query<T>;

const STORE = [REALTIME_TOPIC.STORE] as const;

function define<T>(key: string, load: () => Promise<T>): StoreQuery<T> {
  return defineQuery(key, STORE, load);
}

export const storeQuery = {
  /** The user's cart. Read by the cart screen and by every header badge. */
  cart: (): StoreQuery<CartResult> => define("store:cart", () => getCart()),

  /** Address, delivery promise and totals for the order about to be placed. */
  checkout: (): StoreQuery<StoreCheckout> => define("store:checkout", () => getCheckout()),

  /** Departments, banners and the store config — the shop front's chrome. */
  home: (): StoreQuery<StoreHome> => define("store:home", () => getStoreHome()),

  order: (orderId: string): StoreQuery<StoreOrder> =>
    define(`store:order:${orderId}`, () => getStoreOrder(orderId)),

  orders: (status: "all" | "open"): StoreQuery<StoreOrderPage> =>
    define(`store:orders:${status}`, () => listStoreOrders({ pageSize: 50, status })),

  /** Kept as the server's `{ product, related }` pair — the screen renders both. */
  product: (
    handle: string,
  ): StoreQuery<{ product: StoreProduct; related: StoreProduct[] }> =>
    define(`store:product:${handle}`, () => getStoreProduct(handle)),

  /**
   * A page of the grid.
   *
   * Every field that changes the answer is in the key — including `pageSize`,
   * because the shop front asks for 24 and the category page for 40 and they are
   * not the same list. **`search` must not be passed here**; see the note above.
   */
  products: (query: Omit<StoreProductQuery, "search">): StoreQuery<StoreProductPage> =>
    define(
      `store:products:${query.category ?? "all"}:${query.sort ?? "default"}:${query.pageSize ?? 0}`,
      () => listStoreProducts(query),
    ),

  /** The categories screen: every department with a row of its products. */
  shelves: (): StoreQuery<StoreShelf[]> => define("store:shelves", () => getStoreShelves()),
};
