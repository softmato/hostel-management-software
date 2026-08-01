import { Schema, model, models } from "mongoose";

/**
 * Record of a consent given or withdrawn (PRIVACY_POLICY.md). Location tracking
 * is opt-in and revocable, and this is the evidence of which way it stands and
 * when it changed. Rows are append-only: a withdrawal is a new GRANTED=false
 * entry, never an edit of the original.
 */
const consentLogSchema = new Schema(
  {
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    hostelId: { ref: "Hostel", type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", type: Schema.Types.ObjectId },
    consentType: {
      enum: ["LOCATION_TRACKING", "TERMS_OF_USE", "PRIVACY_POLICY"],
      required: true,
      type: String,
    },
    granted: { required: true, type: Boolean },
    /** Version of the policy text the user actually saw. */
    policyVersion: { trim: true, type: String },
    recordedAt: { default: Date.now, type: Date },
    source: { default: "WEB", enum: ["WEB", "MOBILE"], type: String },
  },
  { timestamps: true },
);

consentLogSchema.index({ userId: 1, consentType: 1, recordedAt: -1 });
consentLogSchema.index({ hostelId: 1, consentType: 1 });

export const ConsentLogModel =
  models.ConsentLog || model("ConsentLog", consentLogSchema);
