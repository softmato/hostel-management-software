import { Schema, model, models } from "mongoose";

/**
 * Raised when a resident has been away (OUTSIDE or UNKNOWN) for the hostel's
 * configured number of consecutive days (PHASES.md §4.1). One open alert per
 * resident at a time — the streak is a single ongoing situation, not a new
 * incident every night.
 */
const attendanceAlertSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", required: true, type: Schema.Types.ObjectId },
    consecutiveDays: { min: 1, required: true, type: Number },
    lastSeenAt: Date,
    status: {
      default: "OPEN",
      enum: ["OPEN", "RESOLVED"],
      type: String,
    },
    resolutionNote: { trim: true, type: String },
    resolvedAt: Date,
    resolvedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

attendanceAlertSchema.index({ hostelId: 1, status: 1, createdAt: -1 });
attendanceAlertSchema.index(
  { residentId: 1, status: 1 },
  { partialFilterExpression: { status: "OPEN" }, unique: true },
);

export const AttendanceAlertModel =
  models.AttendanceAlert || model("AttendanceAlert", attendanceAlertSchema);
