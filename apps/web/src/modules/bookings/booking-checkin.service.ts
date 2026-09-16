import "server-only";

import type { Types } from "mongoose";

import { BookingModel } from "@hostel/db/models/Booking";
import { UserModel } from "@hostel/db/models/User";
import { rupees } from "@hostel/shared/email/templates/booking/parts";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { logger } from "@/lib/logger";
import { endAsNoShow } from "@/modules/bookings/booking-answer.service";
import { endBooking } from "@/modules/bookings/booking-lifecycle";
import { notifyPlatform } from "@/modules/bookings/booking-notify";
import type { BookingRecord } from "@/modules/bookings/booking-views";
import {
  claimBedForRoomType,
  moveBedBetweenRoomTypes,
  releaseBedForRoomType,
} from "@/modules/hostels/hostel-capacity.service";
import { normalizeResidentId } from "@/modules/users/resident-identity.service";

/**
 * Moving in closes a booking: docs/BOOKINGS.md, "Moved in = the card scan".
 *
 * The hostel admits the person through the ordinary *Register a new resident*
 * intake. When the card scanned there belongs to an account holding a confirmed
 * booking at this hostel, three things differ from a walk-in: the bed the
 * booking holds becomes the resident's instead of a second one being claimed,
 * it moves across if they took another room type, and the booking ends as
 * `CHECKED_IN` — nothing refunded, the hostel's share due.
 */

/**
 * The confirmed booking this account holds here, while its hold is still
 * running. A hold that has already lapsed is ended as a no-show on the spot —
 * the sweep would have — so the intake claims a bed the ordinary way.
 */
export async function findHeldBooking(
  hostelId: Types.ObjectId | string,
  userId: Types.ObjectId | string,
  now = new Date(),
) {
  const booking = await BookingModel.findOne({ hostelId, status: "CONFIRMED", userId }).lean<BookingRecord | null>();

  if (!booking) {
    return null;
  }

  if (booking.holdEndsAt && now.getTime() >= new Date(booking.holdEndsAt).getTime()) {
    await endAsNoShow(booking, now);

    return null;
  }

  return booking;
}

export type CardBooking = {
  code: string;
  guestName: string;
  holdEndsAt: string | null;
  roomType: string;
};

/**
 * What the intake screen says when a card is scanned or typed: the booking this
 * registration will close, if any. The same lookup `createResident` makes, so
 * the banner and the write never disagree.
 */
export async function findCardBooking(
  hostelId: Types.ObjectId | string,
  scannedResidentId: string,
): Promise<CardBooking | null> {
  const residentId = normalizeResidentId(scannedResidentId);

  if (!residentId) {
    return null;
  }

  await connectToDatabase();

  const user = await UserModel.findOne({ isDeleted: { $ne: true }, userResidentId: residentId })
    .select("_id")
    .lean<{ _id: Types.ObjectId } | null>();
  const booking = user ? await findHeldBooking(hostelId, user._id) : null;

  return booking
    ? {
        code: booking.code,
        guestName: booking.guest.name,
        holdEndsAt: booking.holdEndsAt ? new Date(booking.holdEndsAt).toISOString() : null,
        roomType: booking.roomType,
      }
    : null;
}

/** The held bed becomes the resident's. Throws, before anything is written, if another room type is full. */
export async function takeHeldBed(booking: BookingRecord, roomType: string) {
  if (!booking.bedHeld) {
    await claimBedForRoomType(booking.hostelId, roomType);

    return;
  }

  if (booking.roomType !== roomType) {
    await moveBedBetweenRoomTypes(booking.hostelId, booking.roomType, roomType);
  }
}

/** Undoes `takeHeldBed` when the resident could not be written: the booking keeps its bed. */
export async function returnHeldBed(booking: BookingRecord, roomType: string) {
  if (!booking.bedHeld) {
    await releaseBedForRoomType(booking.hostelId, roomType);

    return;
  }

  if (booking.roomType !== roomType) {
    await moveBedBetweenRoomTypes(booking.hostelId, roomType, booking.roomType);
  }
}

export async function checkInBooking(
  booking: BookingRecord,
  input: { principal: ApiPrincipal; residentId: Types.ObjectId; roomType: string },
  now = new Date(),
) {
  const ended = await endBooking(booking, {
    actorId: input.principal.userId,
    from: ["CONFIRMED"],
    now,
    releaseBed: false,
    set: { checkedInAt: now, checkedInBy: input.principal.userId, residentId: input.residentId },
    status: "CHECKED_IN",
  });

  if (!ended) {
    /*
     * The booking left CONFIRMED between the lookup and now — cancelled, or
     * swept — and that ending released one bed of the booking's room type.
     * `takeHeldBed` had already made that bed the resident's (or moved it), so
     * the count is one too generous: take it back.
     */
    await claimBedForRoomType(booking.hostelId, booking.roomType).catch((error: unknown) => {
      logger.error("A resident was admitted on a booking that ended at the same moment; the bed count could not be corrected.", {
        bookingId: String(booking._id),
        error: error instanceof Error ? error.message : String(error),
        residentId: String(input.residentId),
      });
    });

    return null;
  }

  const hostelShare = ended.settlement?.hostelShare ?? 0;

  if (hostelShare > 0) {
    await notifyPlatform(ended, {
      action: "booking_checked_in",
      body: `${ended.code}: ${ended.guest.name} moved in at ${ended.hostelSnapshot.name}. Payout ${rupees(hostelShare)} to send.`,
      tab: "payouts",
      title: "Payout to send",
      type: "BOOKING_MONEY_DUE",
    });
  }

  return ended;
}
