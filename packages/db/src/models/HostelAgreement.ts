import { Schema, model, models } from "mongoose";

/**
 * One agreement Softmato signed with a hostel — a line on the registration track
 * sheet (`/hostel-registration-track-sheet`).
 *
 * `refCode` is the legal reference printed on the agreement
 * (`marketing/agreement/source/agreement.html`): `SMT/HP/2026/007`. It is
 * allocated once, from the `HOSTEL_AGREEMENT` run in `PlatformDocumentSequence`,
 * and never handed out again — which is why a deleted line is only marked
 * `deletedAt`: the number it held stays visibly spent.
 */

export const HOSTEL_AGREEMENT_STATUSES = ["SIGNED", "ACTIVE", "ENDED"] as const;

const hostelAgreementSchema = new Schema(
  {
    /** The run's number, `7` in `SMT/HP/2026/007`. */
    sequence: { min: 1, required: true, type: Number },
    refCode: { required: true, trim: true, type: String },
    hostelName: { required: true, trim: true, type: String },
    location: { default: "", trim: true, type: String },
    ownerName: { default: "", trim: true, type: String },
    phone: { default: "", trim: true, type: String },
    /** The Nepal day it was signed, as UTC midnight. */
    signedOn: { required: true, type: Date },
    status: {
      default: "SIGNED",
      enum: HOSTEL_AGREEMENT_STATUSES,
      required: true,
      type: String,
    },
    notes: { default: "", trim: true, type: String },
    deletedAt: { default: null, type: Date },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

hostelAgreementSchema.index({ refCode: 1 }, { unique: true });
hostelAgreementSchema.index({ sequence: 1 }, { unique: true });

export const HostelAgreementModel =
  models.HostelAgreement || model("HostelAgreement", hostelAgreementSchema);
