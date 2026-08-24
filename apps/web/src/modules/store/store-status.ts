/**
 * The order lifecycle, as pure data.
 *
 * Kept out of the service on purpose: "can this order still be cancelled" is
 * asked in three places — the buyer's cancel route, the platform's status route,
 * and the phone, which greys the button out before anyone taps it — and three
 * copies of the answer is how the phone ends up offering an action the API
 * refuses. This module is the single copy, and it has tests.
 */

export const STORE_ORDER_STATUSES = [
  "PLACED",
  "CONFIRMED",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;

export type StoreOrderStatus = (typeof STORE_ORDER_STATUSES)[number];

/**
 * Where the platform may move an order from each state.
 *
 * Forward one step at a time, with `CANCELLED` reachable until it ships. There
 * is deliberately no way back: an order marked `SHIPPED` by mistake is corrected
 * by cancelling and re-placing, not by rewinding, because the timeline the buyer
 * reads has to be a record of what happened rather than of what was typed.
 *
 * `DELIVERED` and `CANCELLED` are terminal — both have `[]`, and that is what
 * makes "is this order finished" a lookup rather than a second list.
 */
const TRANSITIONS: Record<StoreOrderStatus, readonly StoreOrderStatus[]> = {
  CANCELLED: [],
  CONFIRMED: ["PACKED", "SHIPPED", "CANCELLED"],
  DELIVERED: [],
  PACKED: ["SHIPPED", "CANCELLED"],
  PLACED: ["CONFIRMED", "PACKED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
};

/** Statuses that still want something from the platform. Drives the "open" filter. */
export const OPEN_STORE_ORDER_STATUSES: readonly StoreOrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PACKED",
  "SHIPPED",
];

export function isTerminalStoreOrderStatus(status: StoreOrderStatus) {
  return TRANSITIONS[status].length === 0;
}

export function canTransitionStoreOrder(from: StoreOrderStatus, to: StoreOrderStatus) {
  return TRANSITIONS[from].includes(to);
}

export function nextStoreOrderStatuses(from: StoreOrderStatus) {
  return TRANSITIONS[from];
}

/**
 * Whether the **buyer** may still pull the order back.
 *
 * Narrower than the platform's `CANCELLED` transition, and that gap is the
 * point: once the parcel is with a courier, cancelling is a conversation, not a
 * button. A hostel that taps cancel on a shipped order gets told to call, which
 * is the truth; letting the tap succeed would mark an order cancelled while a
 * rider is holding it.
 */
export function canBuyerCancelStoreOrder(status: StoreOrderStatus) {
  return status === "PLACED" || status === "CONFIRMED" || status === "PACKED";
}

/** Plain English for the phone and the portal. One wording, both surfaces. */
export const STORE_ORDER_STATUS_LABEL: Record<StoreOrderStatus, string> = {
  CANCELLED: "Cancelled",
  CONFIRMED: "Confirmed",
  DELIVERED: "Delivered",
  PACKED: "Packed",
  PLACED: "Order placed",
  SHIPPED: "Out for delivery",
};
