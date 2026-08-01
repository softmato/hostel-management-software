import { Schema, model, models } from "mongoose";

/**
 * One zone reading for one resident (PHASES.md §4.1, PRIVACY_POLICY.md).
 *
 * Deliberately stores no coordinates. The server computes the distance from the
 * hostel, derives a zone, and throws the latitude/longitude away — a leaked
 * database must not be able to reconstruct where a resident actually was.
 * `distanceMeters` is rounded for the same reason: it locates someone relative
 * to their own hostel, not on a map.
 */
const attendanceLogSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", required: true, type: Schema.Types.ObjectId },
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    /** UTC midnight of the day this reading belongs to. */
    day: { required: true, type: Date },
    recordedAt: { default: Date.now, type: Date },
    zone: {
      enum: ["INSIDE", "NEARBY", "OUTSIDE", "UNKNOWN"],
      required: true,
      type: String,
    },
    distanceMeters: { min: 0, type: Number },
    source: {
      default: "MOBILE_PING",
      enum: ["MOBILE_PING", "MANUAL_OVERRIDE"],
      type: String,
    },
    /** Set only on a manual override, with the staff member who made it. */
    overrideReason: { trim: true, type: String },
    overriddenBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

attendanceLogSchema.index({ hostelId: 1, day: -1 });
// One reading per resident per day — the upsert in the ping handler relies on
// this to correct a day rather than append a second row for it.
attendanceLogSchema.index({ residentId: 1, day: -1 }, { unique: true });
attendanceLogSchema.index({ hostelId: 1, zone: 1, day: -1 });

export const AttendanceLogModel =
  models.AttendanceLog || model("AttendanceLog", attendanceLogSchema);
