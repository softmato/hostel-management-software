import { Schema, model, models } from "mongoose";

const guardianAccessSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", required: true, type: Schema.Types.ObjectId },
    guardianId: { ref: "Guardian", required: true, type: Schema.Types.ObjectId },
    userId: { ref: "User", type: Schema.Types.ObjectId },
    phone: { required: true, trim: true, type: String },
    accessCode: { required: true, trim: true, type: String },
    /**
     * Email-invitation half of the flow (PHASES.md §4.1). A resident invites a
     * guardian by email and the link carries this token; the accessCode above
     * stays as the phone fallback for guardians without a mailbox.
     */
    email: { lowercase: true, trim: true, type: String },
    invitationToken: { trim: true, type: String },
    invitationExpiresAt: Date,
    invitedBy: { ref: "User", type: Schema.Types.ObjectId },
    expiresAt: { required: true, type: Date },
    status: {
      default: "ACTIVE",
      enum: ["ACTIVE", "USED", "REVOKED", "EXPIRED"],
      type: String,
    },
    allowComplaintStatus: { default: false, type: Boolean },
    createdBy: { ref: "User", required: true, type: Schema.Types.ObjectId },
    usedAt: Date,
  },
  { timestamps: true },
);

guardianAccessSchema.index({ phone: 1, accessCode: 1, status: 1 });
guardianAccessSchema.index({ hostelId: 1, residentId: 1, status: 1 });
guardianAccessSchema.index({ userId: 1, status: 1 });
guardianAccessSchema.index(
  { invitationToken: 1 },
  { sparse: true, unique: true },
);

export const GuardianAccessModel =
  models.GuardianAccess || model("GuardianAccess", guardianAccessSchema);
