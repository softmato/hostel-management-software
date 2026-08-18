import { Schema, model, models } from "mongoose";

const sessionSchema = new Schema(
  {
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    /**
     * Set when this session was opened with a temporary credential rather than
     * the account's own password. Revoking that credential revokes every
     * session carrying its id, so a borrowed login can be taken back without
     * signing the owner out of their own devices.
     */
    temporaryCredentialId: {
      default: null,
      ref: "TemporaryCredential",
      type: Schema.Types.ObjectId,
    },
    refreshTokenHash: { type: String, default: null },
    userAgent: String,
    ipAddress: String,
    expiresAt: { type: Date, required: true },
    lastSeenAt: Date,
    revokedAt: { default: null, type: Date },
  },
  { timestamps: true },
);

sessionSchema.index({ userId: 1, expiresAt: 1 });
sessionSchema.index({ refreshTokenHash: 1 });
sessionSchema.index(
  { temporaryCredentialId: 1, revokedAt: 1 },
  { sparse: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SessionModel = models.Session || model("Session", sessionSchema);
