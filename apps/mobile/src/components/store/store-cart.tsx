import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { getCartCount } from "@/lib/store-api";

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
  /** Optimistic local adjustment, replaced by the next fetch. */
  bump: (delta: number) => void;
  refresh: () => void;
};

const StoreCartContext = createContext<StoreCartContextValue | null>(null);

export function StoreCartProvider({ children }: { children: ReactNode }) {
  const count = useResource(
    useCallback(() => getCartCount().catch(() => ({ itemCount: 0, lineCount: 0 })), []),
    { topics: [REALTIME_TOPIC.STORE] },
  );

  const { refresh, setData } = count;

  const bump = useCallback(
    (delta: number) => {
      setData((current) =>
        current
          ? { ...current, itemCount: Math.max(current.itemCount + delta, 0) }
          : { itemCount: Math.max(delta, 0), lineCount: delta > 0 ? 1 : 0 },
      );
    },
    [setData],
  );

  const value = useMemo<StoreCartContextValue>(
    () => ({ bump, itemCount: count.data?.itemCount ?? 0, refresh }),
    [bump, count.data?.itemCount, refresh],
  );

  return <StoreCartContext.Provider value={value}>{children}</StoreCartContext.Provider>;
}

/**
 * Never throws when there is no provider.
 *
 * The product screen sits on the **root stack**, not inside the store group — it
 * opens full-bleed over the tab bar, the way the second reference board draws it
 * — so it renders outside this provider and still needs to add to the cart. A
 * no-op `bump` there is correct: there is no badge on screen to keep in step.
 */
export function useStoreCart(): StoreCartContextValue {
  return (
    useContext(StoreCartContext) ?? {
      bump: () => {},
      itemCount: 0,
      refresh: () => {},
    }
  );
}
