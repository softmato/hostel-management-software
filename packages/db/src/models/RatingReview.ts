import { Schema, model, models } from "mongoose";

const ratingReviewSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", required: true, type: Schema.Types.ObjectId },
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    overallRating: { max: 5, min: 1, required: true, type: Number },
    // The seven categories of PHASES.md §4.1. Only `overallRating` is required;
    // a resident may rate the whole stay without scoring every dimension.
    foodRating: { max: 5, min: 1, type: Number },
    safetyRating: { max: 5, min: 1, type: Number },
    cleanlinessRating: { max: 5, min: 1, type: Number },
    roomRating: { max: 5, min: 1, type: Number },
    locationRating: { max: 5, min: 1, type: Number },
    managementRating: { max: 5, min: 1, type: Number },
    comment: { trim: true, type: String },
    status: {
      default: "VISIBLE",
      enum: ["VISIBLE", "HIDDEN"],
      type: String,
    },
    hiddenAt: Date,
    hiddenBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

ratingReviewSchema.index({ hostelId: 1, residentId: 1 }, { unique: true });
ratingReviewSchema.index({ hostelId: 1, status: 1, createdAt: -1 });

export const RatingReviewModel =
  models.RatingReview || model("RatingReview", ratingReviewSchema);
