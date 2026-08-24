import { describe, expect, it } from "vitest";

import { DEFAULT_STORE_CONFIG } from "@/modules/store/store-config";
import { deliveryPromise } from "@/modules/store/delivery-window";

function nepalTime(isoDate: string) {
  return new Date(isoDate);
}

describe("deliveryPromise", () => {
  it.each([
    ["09:59", "2026-08-24T04:14:00.000Z", "morning"],
    ["10:00", "2026-08-24T04:15:00.000Z", "evening"],
    ["15:59", "2026-08-24T10:14:00.000Z", "evening"],
    ["16:00", "2026-08-24T10:15:00.000Z", "next-day"],
    ["16:01", "2026-08-24T10:16:00.000Z", "next-day"],
    ["midnight", "2026-08-23T18:15:00.000Z", "morning"],
  ])("classifies Nepal time at %s", (_label, isoDate, placedBefore) => {
    expect(deliveryPromise(DEFAULT_STORE_CONFIG, nepalTime(isoDate)).placedBefore).toBe(
      placedBefore,
    );
  });

  it("uses the same-day promise before 4 PM", () => {
    expect(
      deliveryPromise(DEFAULT_STORE_CONFIG, nepalTime("2026-08-24T04:14:00.000Z")),
    ).toMatchObject({
      arrivesText: "today between 4 PM and 7 PM",
      cutoffText: "Order by 10 AM for delivery today between 4 PM and 7 PM.",
    });
  });

  it("switches to the next-day promise at 4 PM", () => {
    expect(
      deliveryPromise(DEFAULT_STORE_CONFIG, nepalTime("2026-08-24T10:15:00.000Z")),
    ).toMatchObject({
      arrivesText: "tomorrow morning before 7 AM",
      cutoffText: "Orders placed after 4 PM arrive tomorrow morning before 7 AM.",
    });
  });
});
