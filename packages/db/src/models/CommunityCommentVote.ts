import { Schema, model, models } from "mongoose";

/**
 * One vote per person per comment — the unique index below is what makes that
 * true, rather than a check the service could forget. `value` is +1 or -1;
 * clearing a vote deletes the row instead of storing a zero, so the collection
 * only ever holds opinions somebody actually holds.
 */
const communityCommentVoteSchema = new Schema(
  {
    commentId: {
      ref: "CommunityComment",
      required: true,
      type: Schema.Types.ObjectId,
    },
    postId: { ref: "CommunityPost", required: true, type: Schema.Types.ObjectId },
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    value: { enum: [-1, 1], required: true, type: Number },
    /** Seeded sample content — see CommunityPost. */
    isDemoData: { default: false, type: Boolean },
  },
  { timestamps: true },
);

communityCommentVoteSchema.index({ commentId: 1, userId: 1 }, { unique: true });

export const CommunityCommentVoteModel =
  models.CommunityCommentVote ||
  model("CommunityCommentVote", communityCommentVoteSchema);
