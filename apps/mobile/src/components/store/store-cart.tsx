import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { getCart, type CartResult } from "@/lib/store-api";

/**
 * One cart count for the whole store group.
 *
 * ## Why the layout owns it and not the tab bar
 *
 * `RoleTabs`'s own doc says it: whoever passes a `badge` owns the fetch behind
 * it, and a tab bar that fetched its own numbers would be a request per role per
 * launch. The store's layout already has to exist to draw four tabs, so the
 * count hangs off that — one small `GET /store/cart/count` for every screen in
 * the group, rather than the shop, the categories and the product page each
 * discovering the basket separately.
 *
 * ## Every write bumps it, and nothing polls
 *
 * `bump` is the optimistic path: adding to the cart from the shop grid updates
 * the badge in the same frame as the toast, because a badge that catches up a
 * second later reads as a badge that missed the tap. `refresh` then reconciles
 * with what the server actually stored — the two disagree whenever a quantity
 * was clamped, and the server wins.
 *
 * The `STORE` topic keeps it live without polling: the platform cancelling an
 * order or delisting a product publishes it, and this refetches silently.
 */

type StoreCartContextValue = {
  /** Units in the basket, not lines. `3 × mattress` is 3. */
  itemCount: number;
  /** Current quantities keyed by the live product id. */
  lineQuantities: Readonly<Record<string, number>>;
  /** Replace the provider with the complete server response from an add. */
  setCart: (result: CartResult) => void;
  refresh: () => void;
};

const StoreCartContext = createContext<StoreCartContextValue | null>(null);

export function StoreCartProvider({ children }: { children: ReactNode }) {
  const cart = useResource(
    useCallback(() => getCart(), []),
    {
      topics: [REALTIME_TOPIC.STORE],
    },
  );

  const { refresh, setData } = cart;

  const setCart = useCallback(
    (result: CartResult) => setData(() => result),
    [setData],
  );

  const lineQuantities = useMemo(
    () =>
      Object.fromEntries(
        (cart.data?.cart.items ?? []).map((line) => [
          line.product.id,
          line.quantity,
        ]),
      ),
    [cart.data?.cart.items],
  );

  const value = useMemo<StoreCartContextValue>(
    () => ({
      itemCount: cart.data?.cart.totals.itemCount ?? 0,
      lineQuantities,
      refresh,
      setCart,
    }),
    [cart.data?.cart.totals.itemCount, lineQuantities, refresh, setCart],
  );

  return (
    <StoreCartContext.Provider value={value}>
      {children}
    </StoreCartContext.Provider>
  );
}

/**
 * Never throws when there is no provider.
 *
 * Root store detail screens get the same provider through `store/_layout.tsx`.
 * The no-op fallback remains useful for a component rendered outside either
 * store layout, without making cart state a global dependency for the app.
 */
export function useStoreCart(): StoreCartContextValue {
  return (
    useContext(StoreCartContext) ?? {
      itemCount: 0,
      lineQuantities: {},
      refresh: () => {},
      setCart: () => {},
    }
  );
}
