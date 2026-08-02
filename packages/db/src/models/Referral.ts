import { Schema, model, models } from "mongoose";

const referralSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    referralCodeId: {
      ref: "ReferralCode",
      required: true,
      type: Schema.Types.ObjectId,
    },
    referrerResidentId: {
      ref: "Resident",
      required: true,
      type: Schema.Types.ObjectId,
    },
    inquiryId: { ref: "Inquiry", type: Schema.Types.ObjectId },
    joinedResidentId: { ref: "Resident", type: Schema.Types.ObjectId },
    name: { required: true, trim: true, type: String },
    phone: { required: true, trim: true, type: String },
    email: { trim: true, type: String },
    message: { trim: true, type: String },
    status: {
      default: "INQUIRY_CREATED",
      enum: ["INQUIRY_CREATED", "JOINED", "REWARDED", "CANCELLED"],
      type: String,
    },
    confirmedAt: Date,
    confirmedBy: { ref: "User", type: Schema.Types.ObjectId },
    /**
     * A referral only counts as *converted* once the person they brought in has
     * had a payment verified (PHASES.md §5.1). Kept as its own flag rather than
     * a `status` value so it can be true while the reward is still PENDING,
     * APPROVED or already PAID.
     */
    converted: { default: false, type: Boolean },
    convertedAt: Date,
    convertedPaymentId: { ref: "Payment", type: Schema.Types.ObjectId },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
    isDeleted: { default: false, type: Boolean },
  },
  { timestamps: true },
);

referralSchema.index({ hostelId: 1, status: 1, createdAt: -1 });
referralSchema.index({ hostelId: 1, phone: 1 });
referralSchema.index({ referrerResidentId: 1, status: 1 });
referralSchema.index({ hostelId: 1, joinedResidentId: 1, converted: 1 });

export const ReferralModel = models.Referral || model("Referral", referralSchema);
