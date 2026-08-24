/**
 * The order lifecycle.
 *
 * Exhaustive on purpose: this table is what both the platform's status route and
 * the phone's button states read, so a gap here is a control the UI offers and
 * the API refuses — or worse, one the API accepts and the UI never shows.
 */
import { describe, expect, it } from "vitest";

import {
  canBuyerCancelStoreOrder,
  canTransitionStoreOrder,
  isTerminalStoreOrderStatus,
  nextStoreOrderStatuses,
  OPEN_STORE_ORDER_STATUSES,
  STORE_ORDER_STATUSES,
  STORE_ORDER_STATUS_LABEL,
  type StoreOrderStatus,
} from "@/modules/store/store-status";

describe("the forward path", () => {
  it.each([
    ["PLACED", "CONFIRMED"],
    ["PLACED", "PACKED"],
    ["CONFIRMED", "PACKED"],
    ["CONFIRMED", "SHIPPED"],
    ["PACKED", "SHIPPED"],
    ["SHIPPED", "DELIVERED"],
  ] as const)("allows %s to %s", (from, to) => {
    expect(canTransitionStoreOrder(from, to)).toBe(true);
  });

  it.each([
    ["DELIVERED", "SHIPPED"],
    ["SHIPPED", "PACKED"],
    ["PACKED", "CONFIRMED"],
    ["CONFIRMED", "PLACED"],
  ] as const)("never rewinds %s to %s", (from, to) => {
    expect(canTransitionStoreOrder(from, to)).toBe(false);
  });

  it("does not let an order skip straight from placed to delivered", () => {
    expect(canTransitionStoreOrder("PLACED", "DELIVERED")).toBe(false);
  });
});

describe("cancellation", () => {
  it.each(["PLACED", "CONFIRMED", "PACKED"] as const)(
    "the platform may cancel a %s order",
    (status) => {
      expect(canTransitionStoreOrder(status, "CANCELLED")).toBe(true);
    },
  );

  it("cannot cancel once it has shipped", () => {
    expect(canTransitionStoreOrder("SHIPPED", "CANCELLED")).toBe(false);
  });

  it("cannot cancel a delivered or already-cancelled order", () => {
    expect(canTransitionStoreOrder("DELIVERED", "CANCELLED")).toBe(false);
    expect(canTransitionStoreOrder("CANCELLED", "CANCELLED")).toBe(false);
  });

  it("lets the buyer pull back anything not yet with a courier", () => {
    expect(canBuyerCancelStoreOrder("PLACED")).toBe(true);
    expect(canBuyerCancelStoreOrder("CONFIRMED")).toBe(true);
    expect(canBuyerCancelStoreOrder("PACKED")).toBe(true);
  });

  it("stops the buyer once it is out for delivery", () => {
    expect(canBuyerCancelStoreOrder("SHIPPED")).toBe(false);
    expect(canBuyerCancelStoreOrder("DELIVERED")).toBe(false);
    expect(canBuyerCancelStoreOrder("CANCELLED")).toBe(false);
  });

  it("never lets the buyer do something the platform could not", () => {
    for (const status of STORE_ORDER_STATUSES) {
      if (canBuyerCancelStoreOrder(status)) {
        expect(canTransitionStoreOrder(status, "CANCELLED")).toBe(true);
      }
    }
  });
});

describe("terminal states", () => {
  it("ends at delivered and cancelled, and nowhere else", () => {
    const terminal = STORE_ORDER_STATUSES.filter(isTerminalStoreOrderStatus);

    expect([...terminal]).toEqual(["DELIVERED", "CANCELLED"]);
  });

  it("offers no next move from a terminal state", () => {
    expect(nextStoreOrderStatuses("DELIVERED")).toEqual([]);
    expect(nextStoreOrderStatuses("CANCELLED")).toEqual([]);
  });
});

describe("the open queue", () => {
  it("is every non-terminal status", () => {
    const nonTerminal = STORE_ORDER_STATUSES.filter(
      (status) => !isTerminalStoreOrderStatus(status),
    );

    expect([...OPEN_STORE_ORDER_STATUSES].sort()).toEqual([...nonTerminal].sort());
  });
});

describe("labels", () => {
  it("names every status, so no screen ever prints a raw enum", () => {
    for (const status of STORE_ORDER_STATUSES) {
      expect(STORE_ORDER_STATUS_LABEL[status as StoreOrderStatus]).toBeTruthy();
    }
  });
});
