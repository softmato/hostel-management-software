import { Schema, model, models } from "mongoose";

/**
 * A superadmin's edit to a money setting, parked until they confirm it by email.
 *
 * Some settings decide where customers' money lands or how much of it goes
 * back — the booking terms, the collection QR. A stolen session must not be
 * able to change them, so saving one only writes a row here and emails a
 * single-use link to the account that asked. Opening that link while signed in
 * as the same superadmin is what applies it.
 *
 * `proposedValue` is the complete, already-validated value, not a patch: what
 * the email showed is exactly what gets written. `previousValue` is kept so the
 * audit trail and the confirm page can show both sides.
 *
 * Only the token's SHA-256 is stored. The link in the inbox is the secret.
 */
export const PLATFORM_SETTING_CHANGE_STATUSES = [
  "PENDING",
  "APPLIED",
  "CANCELLED",
  "EXPIRED",
  /** A newer request for the same setting replaced this one before it was confirmed. */
  "SUPERSEDED",
] as const;

const platformSettingChangeSchema = new Schema(
  {
    /** Which setting — a key of the change registry, e.g. `bookings`. */
    key: { required: true, trim: true, type: String },
    proposedValue: { required: true, type: Schema.Types.Mixed },
    previousValue: { default: null, type: Schema.Types.Mixed },
    tokenHash: { required: true, select: false, type: String },
    expiresAt: { required: true, type: Date },
    status: {
      default: "PENDING",
      enum: PLATFORM_SETTING_CHANGE_STATUSES,
      required: true,
      type: String,
    },
    requestedBy: { ref: "User", required: true, type: Schema.Types.ObjectId },
    /** Where the confirm link went, as it was when sent. */
    requestedEmail: { required: true, trim: true, type: String },
    appliedAt: Date,
    cancelledAt: Date,
    cancelledBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { minimize: false, timestamps: true },
);

platformSettingChangeSchema.index({ key: 1, status: 1, createdAt: -1 });
platformSettingChangeSchema.index({ tokenHash: 1 });

export const PlatformSettingChangeModel =
  models.PlatformSettingChange ||
  model("PlatformSettingChange", platformSettingChangeSchema);
