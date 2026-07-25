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
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

export const HostelSettingsModel =
  models.HostelSettings || model("HostelSettings", hostelSettingsSchema);
