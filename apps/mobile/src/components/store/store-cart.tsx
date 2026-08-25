import * as Haptics from "expo-haptics";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import {
  addToCart,
  getCart,
  removeFromCart,
  setCartQuantity,
  type CartResult,
} from "@/lib/store-api";
import { toastError } from "@/lib/toast";

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
 * ## The tap wins the frame; the server catches up
 *
 * `expect` writes the quantity the user just asked for straight into
 * `lineQuantities`, before any request is made. The control on the card is
 * therefore drawn from what they did, not from what the network has confirmed —
 * on a Nepali mobile connection that round trip is a second or two, and a button
 * that sits there unchanged for two seconds reads as a tap that missed.
 *
 * The override is dropped the moment the response for that product lands, and
 * `setCart` has already replaced the basket with the server's own copy, so what
 * replaces the guess is the truth. A clamp or an outright failure therefore
 * *corrects* the number rather than being papered over — which is the whole
 * reason this is an override keyed by product and not a second source of state
 * that has to be kept in step.
 *
 * The `STORE` topic keeps it live without polling: the platform cancelling an
 * order or delisting a product publishes it, and this refetches silently.
 */

type StoreCartContextValue = {
  /** Forget an optimistic quantity — the server has answered for this product. */
  forget: (productId: string) => void;
  /** What the user just asked for, shown before the request is even sent. */
  expect: (productId: string, quantity: number) => void;
  /** Units in the basket, not lines. `3 × mattress` is 3. Includes the guesses. */
  itemCount: number;
  /** Current quantities keyed by the live product id, guesses included. */
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

  const [expected, setExpected] = useState<Record<string, number>>({});

  const expect = useCallback((productId: string, quantity: number) => {
    setExpected((current) => ({ ...current, [productId]: Math.max(quantity, 0) }));
  }, []);

  const forget = useCallback((productId: string) => {
    setExpected((current) => {
      if (!(productId in current)) {
        // Returning the same object keeps this from rendering every consumer
        // for a key that was never there — `forget` runs on every settled
        // request, including the ones nobody guessed ahead of.
        return current;
      }

      const { [productId]: _dropped, ...rest } = current;

      return rest;
    });
  }, []);

  const lineQuantities = useMemo(() => {
    const merged: Record<string, number> = Object.fromEntries(
      (cart.data?.cart.items ?? []).map((line) => [line.product.id, line.quantity]),
    );

    for (const [productId, quantity] of Object.entries(expected)) {
      if (quantity <= 0) {
        delete merged[productId];
      } else {
        merged[productId] = quantity;
      }
    }

    return merged;
  }, [cart.data?.cart.items, expected]);

  /*
   * Summed from the merged map rather than read off `totals.itemCount`, so the
   * tab badge moves in the same frame as the button. The server's own total is
   * the sum of exactly these lines, so once the overrides clear the two agree by
   * construction rather than by luck.
   */
  const itemCount = useMemo(
    () =>
      Object.keys(expected).length === 0
        ? (cart.data?.cart.totals.itemCount ?? 0)
        : Object.values(lineQuantities).reduce((sum, quantity) => sum + quantity, 0),
    [cart.data?.cart.totals.itemCount, expected, lineQuantities],
  );

  const value = useMemo<StoreCartContextValue>(
    () => ({
      expect,
      forget,
      itemCount,
      lineQuantities,
      refresh,
      setCart,
    }),
    [expect, forget, itemCount, lineQuantities, refresh, setCart],
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
      expect: () => {},
      forget: () => {},
      itemCount: 0,
      lineQuantities: {},
      refresh: () => {},
      setCart: () => {},
    }
  );
}


/**
 * Adding to the basket, for every screen that can do it.
 *
 * ## The confirmation is a vibration, and nothing else
 *
 * There is deliberately no success toast and no notification here. A hostel
 * admin restocking supplies taps `+` a dozen times in a row, and a banner per
 * tap — on screen or in the shade — is a queue of dismissals for something they
 * can already see: the button flips to a tick and the cart badge climbs in the
 * same frame. What that leaves missing is the confirmation you feel without
 * looking, so the success is a haptic. Only orders are worth a notification.
 *
 * Failure keeps its toast: a tap that did *nothing* looks identical to a tap
 * that worked, and a buzz alone cannot say why.
 *
 * ## One hook rather than a handler per screen
 *
 * The shop, the departments screen and the product page each had their own copy
 * of this, and they had already drifted — the departments one silently dropped
 * the clamp warning, so asking for twelve with four in stock added four and
 * said nothing until checkout. Whoever writes the fourth screen gets it right
 * by importing this.
 */
export function useAddToCart() {
  const { expect, forget, lineQuantities, refresh, setCart } = useStoreCart();
  const [addingProductId, setAddingProductId] = useState<string | null>(null);

  /*
   * The newest request per product wins.
   *
   * Optimistic controls invite fast repeated taps, and `setCartQuantity` is
   * absolute — so two taps a frame apart send "2" then "3", and if those
   * responses arrive out of order the slower one writes 2 over the 3 that is on
   * screen and stays there. Stamping each call and ignoring anything but the
   * latest ticket makes the ordering irrelevant, which is cheaper than
   * serialising the taps and does not make the second one feel slow.
   */
  const ticket = useRef<Record<string, number>>({});

  const run = useCallback(
    async (
      productId: string,
      optimisticQuantity: number,
      request: () => Promise<CartResult>,
    ) => {
      // Painted first, and deliberately before the haptic: the frame the finger
      // is still down for is the one that has to show the change.
      expect(productId, optimisticQuantity);
      setAddingProductId(productId);

      const mine = (ticket.current[productId] ?? 0) + 1;
      ticket.current[productId] = mine;

      try {
        const result = await request();

        if (ticket.current[productId] !== mine) {
          // Overtaken. A newer tap owns both the screen and the basket now.
          return;
        }

        setCart(result);
        forget(productId);

        if (result.clamped) {
          /*
           * The server capped it, so the number that was drawn a moment ago was
           * optimistic in the literal sense. Dropping the override above has
           * already corrected it; this says why, because a figure that changes
           * under you without explanation is worse than one that was never
           * shown.
           */
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          toastError(
            result.clamped === "stock" ? "Not that many in stock" : "Over the limit",
            result.clamped === "stock"
              ? "The quantity was reduced to what is left."
              : "That is over the per-order limit for this product.",
          );
        }
      } catch (error) {
        if (ticket.current[productId] !== mine) {
          return;
        }

        // Dropping the override *is* the rollback: what shows next is whatever
        // the server last told us, which is the state the request failed to
        // change.
        forget(productId);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        toastError("Could not update the cart", readApiError(error));
      } finally {
        if (ticket.current[productId] === mine) {
          setAddingProductId(null);
          refresh();
        }
      }
    },
    [expect, forget, refresh, setCart],
  );

  /**
   * Adds to the basket. Additive — twice with `1` leaves two, which is what the
   * server's `POST /store/cart/items` does and what every shop in the
   * references does.
   *
   * ## The confirmation is a vibration, and nothing else
   *
   * There is deliberately no success toast and no notification. A hostel admin
   * restocking supplies taps `+` a dozen times in a row, and a banner per tap —
   * on screen or in the shade — is a queue of dismissals for something they can
   * already see: the control has become a stepper and the cart badge has
   * climbed. What that leaves missing is the confirmation you feel without
   * looking, so the success is a haptic. Only orders are worth a notification.
   *
   * Failure keeps its toast: a tap that did *nothing* looks identical to a tap
   * that worked, and a buzz alone cannot say why.
   *
   * ## One hook rather than a handler per screen
   *
   * The shop, the departments screen and the product page each had their own
   * copy of this, and they had already drifted — the departments one silently
   * dropped the clamp warning, so asking for twelve with four in stock added
   * four and said nothing until checkout. Whoever writes the fourth screen gets
   * it right by importing this.
   */
  const add = useCallback(
    async (product: { id: string }, quantity = 1) => {
      const next = (lineQuantities[product.id] ?? 0) + quantity;

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      await run(product.id, next, () =>
        addToCart({ productId: product.id, quantity }),
      );
    },
    [lineQuantities, run],
  );

  /**
   * Sets a line to an absolute quantity, and removes it at zero.
   *
   * The shop grid needs this and not just `add`, because once something is in
   * the basket the control on the card stops being a button and becomes a
   * stepper — and a stepper whose minus can only ever add is the bug this
   * replaced.
   *
   * `0` goes to `removeFromCart` rather than to `setCartQuantity(0)`. The server
   * accepts both and treats them the same, but the DELETE is the one that says
   * what happened, and it is what the cart screen already calls.
   */
  const setQuantity = useCallback(
    async (product: { id: string }, next: number) => {
      void Haptics.selectionAsync();

      await run(product.id, next, () =>
        next <= 0 ? removeFromCart(product.id) : setCartQuantity(product.id, next),
      );
    },
    [run],
  );

  return { add, addingProductId, setQuantity };
}
