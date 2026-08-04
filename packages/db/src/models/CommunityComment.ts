import { Schema, model, models } from "mongoose";

const communityCommentSchema = new Schema(
  {
    postId: { ref: "CommunityPost", required: true, type: Schema.Types.ObjectId },
    /**
     * Null on a top-level comment. Replies nest one level per hop; the depth of
     * the tree is not capped in the database because the reader collapses deep
     * threads rather than the writer being stopped from making them.
     */
    parentId: { default: null, ref: "CommunityComment", type: Schema.Types.ObjectId },
    /**
     * Net votes, denormalised so a thread renders without a per-comment count.
     * `CommunityCommentVote` holds the authoritative per-user rows; this is
     * recomputed from them on every vote rather than blindly incremented.
     */
    score: { default: 0, type: Number },
    /** Mirrors the post's space: null on a public-space post. */
    hostelId: { default: null, ref: "Hostel", type: Schema.Types.ObjectId },
    /** Null only after the author's account is purged — see CommunityPost. */
    authorId: { default: null, ref: "User", type: Schema.Types.ObjectId },
    body: { maxlength: 2000, required: true, trim: true, type: String },
    status: {
      default: "VISIBLE",
      enum: ["VISIBLE", "HIDDEN"],
      type: String,
    },
    hiddenAt: Date,
    hiddenBy: { ref: "User", type: Schema.Types.ObjectId },
    /** Seeded sample content — see CommunityPost. */
    isDemoData: { default: false, type: Boolean },
  },
  { timestamps: true },
);

communityCommentSchema.index({ postId: 1, createdAt: 1 });
communityCommentSchema.index({ parentId: 1, createdAt: 1 });
communityCommentSchema.index({ hostelId: 1, status: 1 });

export const CommunityCommentModel =
  models.CommunityComment || model("CommunityComment", communityCommentSchema);
