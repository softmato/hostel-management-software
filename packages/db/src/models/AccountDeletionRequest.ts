import { Schema, model, models } from "mongoose";

/**
 * Account deletion requests (ARCHITECTURE.md §13, PRIVACY_POLICY.md §8).
 *
 * Two shapes share this collection, distinguished by `kind`:
 *
 * - **`SELF_SERVICE`** — the 60-day grace period. The account is suspended the
 *   moment the request lands, the clock in `scheduledDeletionAt` runs, and the
 *   purge cron executes it unless the user cancels first. Only accounts that
 *   are nobody else's dependency take this path.
 *
 * - **`PLATFORM_REVIEW`** — a hostel owner cannot delete themselves out from
 *   under their own residents, payments and staff. Their request is instead
 *   routed to the platform owner as a reviewable record, and *nothing happens
 *   to the account* until a SUPERADMIN acts on it. `scheduledDeletionAt` stays
 *   unset until approval, which is what keeps the purge cron away from it.
 *
 * One row per user (`userId` is unique), so a request must be cancelled or
 * closed before another can be opened.
 */
const accountDeletionRequestSchema = new Schema(
  {
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId, unique: true },
    /** Required in both shapes — the policy asks the user to say why. */
    reason: { required: true, trim: true, type: String },
    kind: {
      default: "SELF_SERVICE",
      enum: ["SELF_SERVICE", "PLATFORM_REVIEW"],
      required: true,
      type: String,
    },
    /** Snapshot of who they were when they asked, so a purged user still reads. */
    requestedRole: { required: true, type: String },
    requestedEmail: { lowercase: true, required: true, trim: true, type: String },
    requestedName: { trim: true, type: String },
    /** Hostels the account was attached to — context for the reviewer. */
    hostelIds: [{ ref: "Hostel", type: Schema.Types.ObjectId }],
    requestedAt: { default: Date.now, required: true, type: Date },
    /** `requestedAt + 60 days`. Unset on PLATFORM_REVIEW until approval. */
    scheduledDeletionAt: Date,
    cancelled: { default: false, type: Boolean },
    cancelledAt: Date,
    executed: { default: false, type: Boolean },
    executedAt: Date,
    /** PLATFORM_REVIEW only. `PENDING` is what the superadmin queue lists. */
    reviewStatus: {
      enum: ["PENDING", "APPROVED", "REJECTED"],
      type: String,
    },
    reviewedAt: Date,
    reviewedBy: { ref: "User", type: Schema.Types.ObjectId },
    reviewNote: { trim: true, type: String },
  },
  { timestamps: true },
);

// The purge cron's query: due, still live.
accountDeletionRequestSchema.index({
  scheduledDeletionAt: 1,
  executed: 1,
  cancelled: 1,
});
// The superadmin review queue.
accountDeletionRequestSchema.index({ kind: 1, reviewStatus: 1, requestedAt: -1 });

export const AccountDeletionRequestModel =
  models.AccountDeletionRequest ||
  model("AccountDeletionRequest", accountDeletionRequestSchema);
