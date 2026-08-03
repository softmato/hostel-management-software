import { Schema, model, models } from "mongoose";

const communityCommentSchema = new Schema(
  {
    postId: { ref: "CommunityPost", required: true, type: Schema.Types.ObjectId },
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    /** Null only after the author's account is purged — see CommunityPost. */
    authorId: { default: null, ref: "User", type: Schema.Types.ObjectId },
    body: { maxlength: 2000, required: true, trim: true, type: String },
    isAnonymous: { default: false, type: Boolean },
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

communityCommentSchema.index({ postId: 1, createdAt: 1 });
communityCommentSchema.index({ hostelId: 1, status: 1 });

export const CommunityCommentModel =
  models.CommunityComment || model("CommunityComment", communityCommentSchema);
