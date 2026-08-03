import { Schema, model, models } from "mongoose";

/**
 * A "help me choose a hostel" request from the public compare page's "Talk to
 * an Expert" button. Gated behind sign-in and a completed resident profile
 * (the fill-once resident identity), so the team calling back already has a
 * name and phone without asking the visitor to type them twice.
 */
const expertConsultationRequestSchema = new Schema(
  {
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    fullName: { required: true, trim: true, type: String },
    phone: { required: true, trim: true, type: String },
    email: { trim: true, type: String },
    budgetRange: { trim: true, type: String },
    environment: { trim: true, type: String },
    preferredCollege: { trim: true, type: String },
    /** Free text: hostels or areas the visitor already liked while browsing. */
    likedSpots: { trim: true, type: String },
    status: {
      default: "NEW",
      enum: ["NEW", "CONTACTED", "CLOSED"],
      type: String,
    },
    contactedAt: Date,
    contactedBy: { ref: "User", type: Schema.Types.ObjectId },
    notes: { trim: true, type: String },
  },
  { timestamps: true },
);

// The callback queue: newest-first, filterable by status.
expertConsultationRequestSchema.index({ status: 1, createdAt: -1 });
expertConsultationRequestSchema.index({ userId: 1, createdAt: -1 });

export const ExpertConsultationRequestModel =
  models.ExpertConsultationRequest ||
  model("ExpertConsultationRequest", expertConsultationRequestSchema);
