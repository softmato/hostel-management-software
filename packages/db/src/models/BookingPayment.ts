import { Schema, model, models } from "mongoose";

import { positiveWholeRupees } from "./finance-fields";

/**
 * "I paid the booking fee — here is the screenshot."
 *
 * A claim by the payer, not money received. It is written `IN_REVIEW` and moves
 * nothing; only a superadmin approving it turns the booking into a paid one and
 * issues the receipt. A refusal writes `REJECTED` with the reason and the person
 * may send another — each attempt is its own row, so the trail of what was sent
 * and what was said about it survives.
 */
export const BOOKING_PAYMENT_STATUSES = ["IN_REVIEW", "APPROVED", "REJECTED"] as const;

const bookingPaymentSchema = new Schema(
  {
    bookingId: { ref: "Booking", required: true, type: Schema.Types.ObjectId },
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    /** The booking's fee. The server's figure, never the payer's. */
    amount: { ...positiveWholeRupees, required: true },
    /** The screenshot, for the manual lane. Absent when Softmato confirmed it. */
    proofAssetId: { default: null, ref: "FileAsset", type: Schema.Types.ObjectId },
    /** Set when the fee came through Softmato checkout rather than a screenshot. */
    softmatoInvoiceNo: { default: null, trim: true, type: String },
    /** The transaction id from the payer's banking app, when they gave one. */
    reference: { default: null, trim: true, type: String },
    note: { default: null, trim: true, type: String },
    status: {
      default: "IN_REVIEW",
      enum: BOOKING_PAYMENT_STATUSES,
      required: true,
      type: String,
    },
    submittedAt: { required: true, type: Date },
    reviewedAt: { default: null, type: Date },
    reviewedBy: { default: null, ref: "User", type: Schema.Types.ObjectId },
    reviewNote: { default: null, trim: true, type: String },
  },
  { timestamps: true },
);

bookingPaymentSchema.index({ status: 1, submittedAt: 1 });
bookingPaymentSchema.index({ bookingId: 1, createdAt: -1 });
// One row per Softmato invoice, however many settlers race to write it.
bookingPaymentSchema.index(
  { softmatoInvoiceNo: 1 },
  { partialFilterExpression: { softmatoInvoiceNo: { $type: "string" } }, unique: true },
);

export const BookingPaymentModel =
  models.BookingPayment || model("BookingPayment", bookingPaymentSchema);
