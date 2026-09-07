import { Schema, model, models } from "mongoose";

/**
 * One row per cook a hostel has ever given access to.
 *
 * ## Why this exists at all
 *
 * The kitchen used to be a single field on `HostelSettings` — `cookUserId`,
 * plus the name and the issue date — which meant a hostel had exactly one cook
 * login, forever, and the only way to retire it was to suspend the account and
 * leave the row pointing at it. A hostel with a morning cook and an evening
 * cook had nowhere to put the second one, and a cook who left could not be
 * removed without erasing who had announced last month's meals.
 *
 * So the roster is its own collection. `HostelSettings.cookUserId` is still
 * written — it names the hostel's *primary* cook so older reads keep working —
 * but it is a pointer into this collection, not the source of truth.
 *
 * ## Two kinds of cook
 *
 * - `CREDENTIAL` — the generated login. Short address, no real mailbox behind
 *   it, password handed to the hostel admin to pass on. This is what a kitchen
 *   that shares one phone actually uses.
 * - `INVITE` — a real person's mailbox. The admin sends an invitation, the cook
 *   opens it and their own account becomes the cook account, exactly the way a
 *   resident invites a guardian.
 *
 * ## Removal keeps the history
 *
 * Removing a cook takes their access away for good, but the meals they
 * announced and the photos they posted stay in the record — so the row survives
 * with `status: "REMOVED"` and a frozen {@link historicalName} ("Previous
 * Sunrise cook"). Attribution reads resolve through this collection, so past
 * work is never orphaned and never keeps showing a name that no longer has
 * access.
 */
const cookAccountSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    /**
     * The User this cook signs in as.
     *
     * Set immediately for `CREDENTIAL` cooks — the account is minted with the
     * row. Absent for an `INVITE` until the invitation is accepted, because
     * until then there may be no account on that address at all.
     *
     * **Kept after removal.** It is the join key that lets a FoodReadyLog from
     * six months ago still find the name it should be shown under.
     */
    userId: { ref: "User", type: Schema.Types.ObjectId },
    kind: { enum: ["CREDENTIAL", "INVITE"], required: true, type: String },
    /** Display name. What residents see beside a photo or an announcement. */
    name: { required: true, trim: true, type: String },
    /**
     * The address this cook signs in with: the generated short login for
     * `CREDENTIAL`, the invited mailbox for `INVITE`. Stored lowercase.
     */
    loginEmail: { lowercase: true, required: true, trim: true, type: String },
    status: {
      default: "ACTIVE",
      enum: ["INVITED", "ACTIVE", "REMOVED"],
      required: true,
      type: String,
    },
    /** When the current `CREDENTIAL` password was issued. Rotation moves it. */
    credentialIssuedAt: Date,
    /** Single-use invitation token. Cleared the moment it is accepted. */
    invitationToken: { select: false, type: String },
    invitationExpiresAt: Date,
    acceptedAt: Date,
    removedAt: Date,
    /**
     * The name this cook's past work is shown under once they are removed —
     * `Previous <hostel's first word> cook`.
     *
     * Frozen at removal rather than computed at read time: the hostel can be
     * renamed, and a meal announced in Bhadra was announced by the cook of the
     * hostel as it was called then.
     */
    historicalName: { trim: true, type: String },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

cookAccountSchema.index({ hostelId: 1, status: 1 });
cookAccountSchema.index({ hostelId: 1, createdAt: -1 });
cookAccountSchema.index({ userId: 1 });
cookAccountSchema.index({ loginEmail: 1 });

export const CookAccountModel =
  models.CookAccount || model("CookAccount", cookAccountSchema);
