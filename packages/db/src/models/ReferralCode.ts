import { Schema, model, models } from "mongoose";

const referralCodeSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", required: true, type: Schema.Types.ObjectId },
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    code: { required: true, trim: true, type: String, unique: true },
    status: {
      default: "ACTIVE",
      enum: ["ACTIVE", "INACTIVE"],
      type: String,
    },
    joinedCount: { default: 0, min: 0, type: Number },
    /** Referees whose first payment has been verified. */
    convertedCount: { default: 0, min: 0, type: Number },
    rewardCount: { default: 0, min: 0, type: Number },
  },
  { timestamps: true },
);

referralCodeSchema.index({ code: 1 }, { unique: true });
referralCodeSchema.index({ hostelId: 1, residentId: 1 }, { unique: true });

export const ReferralCodeModel =
  models.ReferralCode || model("ReferralCode", referralCodeSchema);
