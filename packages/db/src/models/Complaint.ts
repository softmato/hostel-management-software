import { Schema, model, models } from "mongoose";

const complaintSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", required: true, type: Schema.Types.ObjectId },
    title: { required: true, trim: true, type: String },
    description: { required: true, trim: true, type: String },
    category: {
      default: "OTHER",
      enum: [
        "FOOD",
        "ROOM",
        "MAINTENANCE",
        "SAFETY",
        "PAYMENT",
        "STAFF",
        "NOISE",
        "OTHER",
      ],
      type: String,
    },
    isAnonymous: { default: false, type: Boolean },
    status: {
      default: "PENDING",
      enum: ["PENDING", "IN_PROGRESS", "RESOLVED", "REJECTED"],
      type: String,
    },
    adminResponse: { trim: true, type: String },
    slaDueAt: { required: true, type: Date },
    /**
     * Set once by the SLA cron when a still-open complaint passes slaDueAt.
     * Presence is what makes the breach alert idempotent — the job only ever
     * looks at complaints where this is missing.
     */
    slaBreachedAt: Date,
    resolvedAt: Date,
    rejectedAt: Date,
    confirmedAt: Date,
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

complaintSchema.index({ hostelId: 1, status: 1, createdAt: -1 });
complaintSchema.index({ hostelId: 1, category: 1, createdAt: -1 });
complaintSchema.index({ residentId: 1, status: 1 });
complaintSchema.index({ hostelId: 1, slaDueAt: 1 });

export const ComplaintModel = models.Complaint || model("Complaint", complaintSchema);
