import { Schema, model, models } from "mongoose";

export const SERVICE_PROVIDER_CATEGORIES = [
  "PLUMBER",
  "ELECTRICIAN",
  "DOCTOR_CLINIC",
  "INTERNET_TECHNICIAN",
  "CLEANER",
  "CARPENTER",
  "PAINTER",
  "WATER_SUPPLIER",
  "APPLIANCE_REPAIR",
  "ROOM_REPAIR",
  "OTHER",
] as const;

const serviceProviderSchema = new Schema(
  {
    fullName: { required: true, trim: true, type: String },
    phone: { required: true, trim: true, type: String },
    /**
     * The account that submitted this application, captured from the Google-gated
     * session on the public registration form (PHASES.md §6.1). Approval upgrades
     * *this* account PUBLIC → SERVICE_PROVIDER, so without it the upgrade has no
     * target. Optional because providers registered by a hostel admin, and every
     * record created before the gate existed, have no submitting account.
     */
    userId: { ref: "User", type: Schema.Types.ObjectId },
    /**
     * Optional — the directory is reachable by phone and many local tradespeople
     * have no working mailbox. Present only so the registration / approval /
     * rejection emails in EMAIL_SYSTEM.md §6 can be sent to those who do; a
     * provider without one is still fully usable, just never emailed.
     */
    email: { lowercase: true, trim: true, type: String },
    /**
     * Primary trade — always `categories[0]`. Kept as a scalar because a lot of
     * read paths (emails, table columns, sorting) want one headline trade, and
     * records created before multi-trade support have only this.
     */
    category: {
      enum: SERVICE_PROVIDER_CATEGORIES,
      required: true,
      type: String,
    },
    /**
     * Every trade this provider works in — a local tradesperson is commonly a
     * plumber *and* a carpenter, and being listed under one skill only would cost
     * them jobs. Matching reads this; `category` is the display headline.
     * Absent on pre-multi-trade records, which fall back to `category`.
     */
    categories: {
      default: undefined,
      type: [{ enum: SERVICE_PROVIDER_CATEGORIES, type: String }],
    },
    area: { required: true, trim: true, type: String },
    city: { default: "Kathmandu", trim: true, type: String },
    availability: { trim: true, type: String },
    description: { trim: true, type: String },
    experience: { trim: true, type: String },
    photoAssetId: { ref: "FileAsset", type: Schema.Types.ObjectId },
    ratingSummary: {
      averageRating: { default: 0, min: 0, type: Number },
      totalReviews: { default: 0, min: 0, type: Number },
    },
    status: {
      default: "PENDING_APPROVAL",
      enum: ["PENDING_APPROVAL", "APPROVED", "REJECTED", "HIDDEN", "INACTIVE"],
      type: String,
    },
    rejectionReason: { trim: true, type: String },
    approvedAt: Date,
    approvedBy: { ref: "User", type: Schema.Types.ObjectId },
    hiddenAt: Date,
    hiddenBy: { ref: "User", type: Schema.Types.ObjectId },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
    isDeleted: { default: false, type: Boolean },
    deletedAt: Date,
    deletedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

serviceProviderSchema.index({ category: 1, area: 1, status: 1 });
// Multikey — "which approved providers in this area do this trade?" is the
// matching query, and it must hit secondary trades too, not just the headline.
serviceProviderSchema.index({ categories: 1, area: 1, status: 1 });
serviceProviderSchema.index({ phone: 1, status: 1 });
serviceProviderSchema.index({ status: 1, createdAt: -1 });
// Sparse: only applications submitted through the public form carry a userId,
// and "has this account already applied?" is read on every landing-page view.
serviceProviderSchema.index({ userId: 1 }, { sparse: true });

export const ServiceProviderModel =
  models.ServiceProvider || model("ServiceProvider", serviceProviderSchema);
