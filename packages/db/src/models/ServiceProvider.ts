import { Schema, model, models } from "mongoose";

const serviceProviderSchema = new Schema(
  {
    fullName: { required: true, trim: true, type: String },
    phone: { required: true, trim: true, type: String },
    /**
     * Optional — the directory is reachable by phone and many local tradespeople
     * have no working mailbox. Present only so the registration / approval /
     * rejection emails in EMAIL_SYSTEM.md §6 can be sent to those who do; a
     * provider without one is still fully usable, just never emailed.
     */
    email: { lowercase: true, trim: true, type: String },
    category: {
      enum: [
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
      ],
      required: true,
      type: String,
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
serviceProviderSchema.index({ phone: 1, status: 1 });
serviceProviderSchema.index({ status: 1, createdAt: -1 });

export const ServiceProviderModel =
  models.ServiceProvider || model("ServiceProvider", serviceProviderSchema);
