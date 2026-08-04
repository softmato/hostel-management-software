import { Schema, model, models } from "mongoose";

/** A resident flagging a post or comment for a hostel admin to look at. */
const communityReportSchema = new Schema(
  {
    postId: { ref: "CommunityPost", required: true, type: Schema.Types.ObjectId },
    commentId: { ref: "CommunityComment", type: Schema.Types.ObjectId },
    /** Mirrors the post's space: null on a public-space post. */
    hostelId: { default: null, ref: "Hostel", type: Schema.Types.ObjectId },
    reportedBy: { ref: "User", required: true, type: Schema.Types.ObjectId },
    reason: { maxlength: 500, required: true, trim: true, type: String },
    status: {
      default: "OPEN",
      enum: ["OPEN", "ACTIONED", "DISMISSED"],
      type: String,
    },
    reviewedAt: Date,
    reviewedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

communityReportSchema.index({ hostelId: 1, status: 1, createdAt: -1 });
// A user reporting the same post twice is the same report, not two.
communityReportSchema.index({ postId: 1, reportedBy: 1 }, { unique: true });

export const CommunityReportModel =
  models.CommunityReport || model("CommunityReport", communityReportSchema);
