import type { BookingAvailability } from "@/lib/booking-api";

/**
 * What a hostel screen shows where a Book button could be. Pure, so it is
 * tested without React Native. The same rules as the website's
 * `modules/bookings/booking-button.ts`: nothing while bookings are off or for an
 * unpriced room; *Full* and *Not taking bookings* only once booking is a thing
 * this visitor could otherwise do.
 */

export type BookState =
  | { fee: number | null; kind: "book" }
  | { kind: "closed" }
  | { kind: "full" }
  | { kind: "hidden" };

const CLOSED_REASONS = new Set(["BOOKINGS_PAUSED", "HOSTEL_SUSPENDED", "NO_PAYOUT_ACCOUNT"]);

export function bookState(availability: BookingAvailability | null, roomType?: string): BookState {
  if (!availability) {
    return { kind: "hidden" };
  }

  if (availability.hostelReason) {
    return CLOSED_REASONS.has(availability.hostelReason) ? { kind: "closed" } : { kind: "hidden" };
  }

  if (roomType === undefined) {
    const fees = availability.rooms.filter((room) => room.bookable).map((room) => room.fee ?? 0);

    if (fees.length > 0) {
      return { fee: Math.min(...fees), kind: "book" };
    }

    return availability.rooms.some((room) => room.reason === "FULL") ? { kind: "full" } : { kind: "hidden" };
  }

  const room = availability.rooms.find((candidate) => candidate.roomType === roomType);

  if (room?.bookable) {
    return { fee: room.fee, kind: "book" };
  }

  return room?.reason === "FULL" ? { kind: "full" } : { kind: "hidden" };
}
