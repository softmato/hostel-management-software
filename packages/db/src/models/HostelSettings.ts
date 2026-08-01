import { Schema, model, models } from "mongoose";

/**
 * Per-hostel operational settings (ARCHITECTURE.md §5, second level of the
 * PlatformConfig → HostelSettings hierarchy). One document per hostel.
 */
const hostelSettingsSchema = new Schema(
  {
    hostelId: {
      ref: "Hostel",
      required: true,
      type: Schema.Types.ObjectId,
      unique: true,
    },
    cookPortalEnabled: { default: false, type: Boolean },
    cookName: { trim: true, type: String },
    cookUserId: { ref: "User", type: Schema.Types.ObjectId },
    /**
     * When the current shared cook password was issued. Only the bcrypt hash is
     * ever stored, so this timestamp (plus the account's `mustChangePassword`
     * flag) is what the dashboard shows in place of the password itself.
     */
    cookCredentialIssuedAt: Date,
    /**
     * Geofence + attendance configuration (PHASES.md §4.1). Radii are metres
     * from the hostel's own coordinates. The platform sets the ceilings; a
     * hostel admin tunes within them.
     */
    attendance: {
      type: {
        /** Absence streak (days) that raises an AttendanceAlert. */
        absenceAlertDays: { default: 14, max: 90, min: 1, type: Number },
        enabled: { default: false, type: Boolean },
        insideZoneRadiusMeters: { default: 50, max: 500, min: 10, type: Number },
        nearbyZoneRadiusMeters: { default: 200, max: 2000, min: 20, type: Number },
        /** How long raw AttendanceLog rows are kept before the purge job. */
        retentionDays: { default: 600, max: 1095, min: 30, type: Number },
        /** Local times (HH:mm) the mobile app is expected to ping at. */
        pingTimes: { default: ["06:00", "08:00", "22:00"], type: [String] },
      },
      default: () => ({}),
    },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

export const HostelSettingsModel =
  models.HostelSettings || model("HostelSettings", hostelSettingsSchema);
