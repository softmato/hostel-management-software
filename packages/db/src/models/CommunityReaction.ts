import { Schema, model, models } from "mongoose";

/**
 * One reaction per user per post — switching type replaces the existing row
 * rather than adding a second one (enforced by the unique index below).
 */
const communityReactionSchema = new Schema(
  {
    postId: { ref: "CommunityPost", required: true, type: Schema.Types.ObjectId },
    /** Mirrors the post's space: null on a public-space post. */
    hostelId: { default: null, ref: "Hostel", type: Schema.Types.ObjectId },
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    type: {
      enum: ["LIKE", "LOVE", "LAUGH", "SAD", "ANGRY", "SUPPORT"],
      required: true,
      type: String,
    },
    /** Seeded sample content — see CommunityPost. */
    isDemoData: { default: false, type: Boolean },
  },
  { timestamps: true },
);

communityReactionSchema.index({ postId: 1, userId: 1 }, { unique: true });
communityReactionSchema.index({ postId: 1, type: 1 });

export const CommunityReactionModel =
  models.CommunityReaction || model("CommunityReaction", communityReactionSchema);
