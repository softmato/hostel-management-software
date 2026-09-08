import { Schema, model, models } from "mongoose";

const nightStatusLogSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", required: true, type: Schema.Types.ObjectId },
    previousStatus: {
      enum: [
        "INSIDE_HOSTEL",
        "OUTSIDE_HOSTEL",
        "NOT_VERIFIED",
        "MARKED_SAFE",
        "SOS_TRIGGERED",
      ],
      type: String,
    },
    nextStatus: {
      enum: [
        "INSIDE_HOSTEL",
        "OUTSIDE_HOSTEL",
        "NOT_VERIFIED",
        "MARKED_SAFE",
        "SOS_TRIGGERED",
      ],
      required: true,
      type: String,
    },
    note: { trim: true, type: String },
    /** The preset behind this change, when one was tapped. Mirrors NightStatus. */
    reasonCode: {
      enum: ["HOME", "FRIENDS", "TRAVELLING", "WORKING_LATE", "HOSPITAL", "OTHER"],
      type: String,
    },
    /** The night the change was about — see the note on `NightStatus.night`. */
    night: { type: String },
    source: {
      default: "RESIDENT",
      enum: ["RESIDENT", "WARDEN_OVERRIDE", "SOS"],
      type: String,
    },
    changedBy: { ref: "User", required: true, type: Schema.Types.ObjectId },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

nightStatusLogSchema.index({ hostelId: 1, createdAt: -1 });
nightStatusLogSchema.index({ residentId: 1, createdAt: -1 });

export const NightStatusLogModel =
  models.NightStatusLog || model("NightStatusLog", nightStatusLogSchema);
