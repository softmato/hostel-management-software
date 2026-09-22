import "server-only";

import { BookingModel } from "@hostel/db/models/Booking";

import { logger } from "@/lib/logger";
import { isSoftmatoDown } from "@/modules/billing/softmato/client";
import { softmato } from "@/modules/billing/softmato/client";
import { isSoftmatoConfigured } from "@/modules/billing/softmato/config";
import { rupeesToPaisa } from "@/modules/billing/softmato/money";
import { rememberTask } from "@/modules/billing/softmato/outage";
import type { BookingRecord } from "@/modules/bookings/booking-views";

/**
 * A booking refund filed with Softmato, where the fee was taken, so its books
 * show the money going back. Softmato records the request (a second person
 * approves it there); sending the money is still done from the transfer queue.
 */
export async function submitBookingRefund(booking: BookingRecord, refund: number): Promise<void> {
  const transactionNo = booking.receiptNumber;

  if (!booking.softmatoInvoiceNo || !transactionNo?.startsWith("TXN-") || !isSoftmatoConfigured()) return;

  await softmato().requestRefund(
    {
      amount_minor: rupeesToPaisa(refund),
      reason: `Booking ${booking.code} ended (${booking.status}).`,
      transaction_id: transactionNo,
    },
    { idempotencyKey: `hh-refund:${String(booking._id)}` },
  );
}

/** Never blocks the ending: an outage is retried by the cron, anything else logged. */
export async function fileBookingRefund(booking: BookingRecord, refund: number): Promise<void> {
  await submitBookingRefund(booking, refund).catch(async (error: unknown) => {
    if (isSoftmatoDown(error)) await rememberTask({ kind: "REFUND_FILING", ref: String(booking._id) });
    else logger.error("Booking refund not filed with Softmato.", { bookingId: String(booking._id), error: String(error) });
  });
}

/** For the retry: throws, so an outage keeps the task open. */
export async function refileBookingRefund(bookingId: string): Promise<void> {
  const booking = await BookingModel.findById(bookingId).lean<BookingRecord | null>();
  const refund = booking?.settlement?.refund ?? 0;

  if (booking && refund > 0) await submitBookingRefund(booking, refund);
}
