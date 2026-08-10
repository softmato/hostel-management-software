import { Schema, model, models } from "mongoose";

const auditLogSchema = new Schema(
  {
    actorId: { ref: "User", required: true, type: Schema.Types.ObjectId },
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
