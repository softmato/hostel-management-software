import { Schema, model, models } from "mongoose";

import { positiveWholeRupees } from "./finance-fields";

/**
 * Money HostelPalika owes out of a booking: a refund to the person, or the
 * hostel's share to the hostel.
 *
 * Raised `DUE` the moment a booking ends with a non-zero amount for somebody,
 * and marked `SENT` by the superadmin who moved the money, with the transaction
 * id. At most one of each kind per booking, enforced by a unique index, so an
 * ending that runs twice cannot owe twice.
 *
 * `destination` is a masked snapshot of where it was sent, taken at the moment
 * it was marked sent — the account on file may change later, and the record of
 * where the money actually went must not change with it.
 */
export const BOOKING_TRANSFER_KINDS = ["REFUND", "PAYOUT"] as const;
export const BOOKING_TRANSFER_STATUSES = ["DUE", "SENT"] as const;

const bookingTransferSchema = new Schema(
  {
    bookingId: { ref: "Booking", required: true, type: Schema.Types.ObjectId },
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    kind: { enum: BOOKING_TRANSFER_KINDS, required: true, type: String },
    amount: { ...positiveWholeRupees, required: true },
    status: { default: "DUE", enum: BOOKING_TRANSFER_STATUSES, required: true, type: String },

    sentAt: { default: null, type: Date },
    sentBy: { default: null, ref: "User", type: Schema.Types.ObjectId },
    transactionId: { default: null, trim: true, type: String },
    proofAssetId: { default: null, ref: "FileAsset", type: Schema.Types.ObjectId },
    note: { default: null, trim: true, type: String },
    /** `HH-BRF-…` for a refund, `HH-BPO-…` for a payout. Numbered when sent. */
    documentNumber: { default: null, trim: true, type: String },
    destination: {
      bankName: { default: "", trim: true, type: String },
      holderName: { default: "", trim: true, type: String },
      method: { default: null, enum: ["BANK", "ESEWA", "KHALTI", null], type: String },
      numberLast4: { default: "", trim: true, type: String },
    },
  },
  { timestamps: true },
);

bookingTransferSchema.index({ bookingId: 1, kind: 1 }, { unique: true });
bookingTransferSchema.index({ kind: 1, status: 1, createdAt: 1 });
bookingTransferSchema.index({ hostelId: 1, kind: 1, status: 1 });

export const BookingTransferModel =
  models.BookingTransfer || model("BookingTransfer", bookingTransferSchema);
