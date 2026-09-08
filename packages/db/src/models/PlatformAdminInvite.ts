import { Schema, model, models } from "mongoose";

import { Role } from "@hostel/shared/types/roles";

/**
 * One outstanding (or settled) invitation to join the platform admin roster.
 *
 * ## Why an invitation rather than a minted account
 *
 * The original path — `createPlatformAdmin` — mints the account there and then
 * with a temporary password and mails it out. That still exists, because a
 * platform whose email delivery is not configured needs a password it can read
 * off the screen and hand over.
 *
 * But it means the roster grows an `INVITED` User the moment somebody types an
 * address, whether or not the person behind it ever shows up, and it hands out
 * a superadmin password that travelled through a mailbox nobody has proved
 * control of. An invitation inverts that: nothing exists on the roster until
 * the recipient opens the emailed link, and opening it *is* the proof that the
 * mailbox is theirs. Only then does an account appear.
 *
 * ## The token is stored hashed
 *
 * `CookAccount` and `GuardianAccess` keep their invitation tokens in the clear
 * behind `select: false`. This one does not, and the divergence is deliberate:
 * those tokens buy a kitchen login and a read-only view of one resident, this
 * one buys the whole platform. A dump of this collection must not be a set of
 * working superadmin links, so only the SHA-256 is stored — the raw token
 * exists in the recipient's email and nowhere else.
 */
const platformAdminInviteSchema = new Schema(
  {
    /** Lowercased. The address the link was mailed to, and the future sign-in. */
    email: { lowercase: true, required: true, trim: true, type: String },
    /** Optional pre-fill; the recipient can give their own name on accept. */
    name: { trim: true, type: String },
    phone: { trim: true, type: String },
    /** The grade this invitation grants once accepted. */
    role: {
      enum: [Role.SUPERADMIN, Role.PLATFORM_MODERATOR],
      required: true,
      type: String,
    },
    /** SHA-256 of the emailed token. Cleared once the invitation settles. */
    tokenHash: { select: false, type: String },
    expiresAt: { required: true, type: Date },
    status: {
      default: "PENDING",
      enum: ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"],
      required: true,
      type: String,
    },
    invitedBy: { ref: "User", required: true, type: Schema.Types.ObjectId },
    acceptedAt: Date,
    /** The account the acceptance created or raised. Kept for the audit trail. */
    acceptedUserId: { ref: "User", type: Schema.Types.ObjectId },
    revokedAt: Date,
    revokedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

/*
 * Partial unique index rather than a plain one: an address may be invited
 * again after a previous invitation was revoked, expired, or accepted and
 * later withdrawn — but never twice at once, which is what makes "already
 * invited" a fact the availability check can state rather than guess.
 */
platformAdminInviteSchema.index(
  { email: 1 },
  { partialFilterExpression: { status: "PENDING" }, unique: true },
);
platformAdminInviteSchema.index({ status: 1, createdAt: -1 });
platformAdminInviteSchema.index({ tokenHash: 1 });

export const PlatformAdminInviteModel =
  models.PlatformAdminInvite ||
  model("PlatformAdminInvite", platformAdminInviteSchema);
