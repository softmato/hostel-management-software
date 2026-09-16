import { Schema, model, models } from "mongoose";

/**
 * Where HostelPalika sends a hostel its share of booking fees.
 *
 * Not the account residents pay rent into — that is `HostelPaymentProfile`,
 * shown to residents on purpose. This one is only ever read by a superadmin
 * sending a payout, so the number is sealed (`sealValue`, scope = this hostel)
 * and only its last four characters are stored in the clear.
 *
 * One row per hostel. A change puts it back into review: payouts wait until a
 * superadmin has looked at the new account, because a changed payout account
 * is exactly what a stolen owner login would do first.
 */
export const PAYOUT_METHODS = ["BANK", "ESEWA", "KHALTI"] as const;
export const PAYOUT_ACCOUNT_STATUSES = ["PENDING_REVIEW", "VERIFIED", "REJECTED"] as const;

const sealedNumberSchema = new Schema(
  {
    authTag: { required: true, type: String },
    ciphertext: { required: true, type: String },
    fingerprint: { required: true, type: String },
    format: { required: true, type: String },
    iv: { required: true, type: String },
    keyId: { required: true, type: String },
    wrappedKey: { required: true, type: String },
    wrappedKeyIv: { required: true, type: String },
    wrappedKeyTag: { required: true, type: String },
  },
  { _id: false },
);

const hostelPayoutAccountSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId, unique: true },
    method: { enum: PAYOUT_METHODS, required: true, type: String },
    holderName: { required: true, trim: true, type: String },
    /** Bank transfers only. */
    bankName: { default: "", trim: true, type: String },
    branch: { default: "", trim: true, type: String },
    number: { required: true, type: sealedNumberSchema },
    numberLast4: { required: true, trim: true, type: String },
    /**
     * Keyed hash of method + number, not scoped to the hostel, so the review
     * queue can say "this account is also on another hostel". Never reversible.
     */
    numberLookup: { required: true, type: String },
    status: {
      default: "PENDING_REVIEW",
      enum: PAYOUT_ACCOUNT_STATUSES,
      required: true,
      type: String,
    },
    reviewNote: { default: null, trim: true, type: String },
    reviewedAt: Date,
    reviewedBy: { ref: "User", type: Schema.Types.ObjectId },
    submittedAt: { required: true, type: Date },
    submittedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

hostelPayoutAccountSchema.index({ status: 1, submittedAt: 1 });
hostelPayoutAccountSchema.index({ numberLookup: 1 });

export const HostelPayoutAccountModel =
  models.HostelPayoutAccount || model("HostelPayoutAccount", hostelPayoutAccountSchema);
