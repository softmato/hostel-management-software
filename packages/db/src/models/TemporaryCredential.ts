import { Schema, model, models } from "mongoose";

/**
 * A second, disposable username + password that opens **the owner's own
 * account** — not a new account and not a sub-account. The holder signs in and
 * lands in the same portal, with the same role, the same hostels and the same
 * data as the owner.
 *
 * It exists for the hand-off cases the platform kept hitting: an owner who
 * wants their accountant to look at the ledger this week, or a resident who
 * wants a parent to open the app once on a borrowed phone — without handing
 * over the real password, which is also the recovery path for the mailbox and
 * cannot be un-shared afterwards.
 *
 * Two properties make it *temporary* rather than a spare password:
 *
 *  - `expiresAt` is mandatory. There is no "never expires" option, so a
 *    forgotten credential dies on its own.
 *  - `revokedAt` kills it, and every session it opened, immediately.
 *
 * `username` is unique **platform-wide**, not per-user: login resolves a
 * username to an owner with nothing else to go on, so two accounts cannot hold
 * the same one. It also never contains `@`, which is what lets the login route
 * tell a temporary username from an email address without a database lookup.
 */
const temporaryCredentialSchema = new Schema(
  {
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    username: { lowercase: true, required: true, trim: true, type: String },
    passwordHash: { required: true, select: false, type: String },
    /** What the owner made it for — "Accountant, October audit". */
    label: { trim: true, type: String },
    expiresAt: { required: true, type: Date },
    revokedAt: { default: null, type: Date },
    lastUsedAt: { default: null, type: Date },
    useCount: { default: 0, type: Number },
    /**
     * Whoever pressed the button. Always the owner today — a temporary session
     * may not mint further credentials — but recorded so the audit trail keeps
     * reading correctly if that ever changes.
     */
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

temporaryCredentialSchema.index({ username: 1 }, { unique: true });
temporaryCredentialSchema.index({ userId: 1, revokedAt: 1, expiresAt: -1 });
/**
 * Rows survive their expiry for 30 days so the owner can still see that the
 * credential existed and when it was last used, then Mongo reaps them and
 * releases the username.
 */
temporaryCredentialSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);

export const TemporaryCredentialModel =
  models.TemporaryCredential ||
  model("TemporaryCredential", temporaryCredentialSchema);
