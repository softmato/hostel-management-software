/** docs/BOOKINGS.md item 21: the app draws the same Book states as the website. */
import { describe, expect, it } from "vitest";

import type { BookingAvailability } from "@/lib/booking-api";
import { bookState } from "@/lib/booking-button";
import { resolvePushPath } from "@/lib/push-link";

const open: BookingAvailability = {
  hostelReason: null,
  rooms: [
    { bookable: true, fee: 700, photos: [], reason: null, roomType: "Double sharing" },
    { bookable: false, fee: 1050, photos: [], reason: "FULL", roomType: "Single" },
    { bookable: false, fee: null, photos: [], reason: "NOT_PRICED", roomType: "Triple" },
  ],
};

describe("bookState", () => {
  it("books a room at its fee and says Full for a full one", () => {
    expect(bookState(open, "Double sharing")).toEqual({ fee: 700, kind: "book" });
    expect(bookState(open, "Single")).toEqual({ kind: "full" });
    expect(bookState(open, "Triple")).toEqual({ kind: "hidden" });
  });

  it("closes a paused hostel and hides everything while bookings are off", () => {
    expect(bookState({ ...open, hostelReason: "BOOKINGS_PAUSED" }, "Double sharing")).toEqual({ kind: "closed" });
    expect(bookState({ ...open, hostelReason: "BOOKINGS_OFF" })).toEqual({ kind: "hidden" });
  });
});

describe("booking push links", () => {
  it("opens the booking a push is about", () => {
    expect(resolvePushPath("/booking/64f0f0f0f0f0f0f0f0f0f0a1")).toBe("/booking/64f0f0f0f0f0f0f0f0f0f0a1");
    expect(resolvePushPath("/bookings")).toBe("/bookings");
    expect(resolvePushPath("/manage/bookings")).toBe("/manage/bookings");
  });
});
