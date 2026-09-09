import { Schema, model, models } from "mongoose";

const auditLogSchema = new Schema(
  {
    /**
     * The account that did it, or null when nothing did.
     *
     * It was `required: true`, which was right for every act the product had
     * at the time: somebody signed in and pressed something. A verified
     * inbound webhook is the first act with no human behind it — Softmato
     * telling us money arrived is not a user doing anything, and inventing an
     * account to satisfy the column would put a name in the audit trail that
     * never touched the payment.
     *
     * So the guarantee is kept where it means something and stated where it
     * does not: `actorType` says which kind of act this was, and the validator
     * below still refuses a `USER` entry with no user. What changed is that
     * "nobody" is now sayable, rather than approximated.
     */
    actorId: { default: null, ref: "User", type: Schema.Types.ObjectId },
    /**
     * `SYSTEM` is a scheduled job or a verified inbound webhook. It is a
     * separate field rather than a sentinel id because a query for "everything
     * this person did" must not have to know which ObjectId means nobody.
     */
    actorType: {
      default: "USER",
      enum: ["USER", "SYSTEM"],
      required: true,
      type: String,
    },
    hostelId: { ref: "Hostel", type: Schema.Types.ObjectId },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    metadata: { default: {}, type: Schema.Types.Mixed },
    /**
     * Hash chain over finance entries only (plan §5.3). Present on entries
     * written through `auditFinanceAction`, absent on every other action —
     * that absence is what scopes the chain, so it must stay sparse.
     */
    financeIntegrity: String,
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/*
 * A `USER` entry must still name its user. This is the half of `required: true`
 * that was load-bearing, kept as a rule rather than as a column constraint that
 * a system act could only satisfy by lying.
 */
auditLogSchema.path("actorId").validate(function actorIdRequiredForUsers(value) {
  return this.actorType !== "USER" || value != null;
}, "actorId is required when actorType is USER.");

auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ hostelId: 1, action: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
// Finds the chain head for a hostel, and lets the drift job walk the chain.
auditLogSchema.index(
  { hostelId: 1, createdAt: -1 },
  { partialFilterExpression: { financeIntegrity: { $exists: true } } },
);

export const AuditLogModel =
  models.AuditLog || model("AuditLog", auditLogSchema);
