import { Schema, model, models } from "mongoose";

/**
 * Resident social feed post (PHASES.md §4.1).
 *
 * `authorId` is always stored even for an anonymous post — moderation and abuse
 * handling need to know who wrote it. Anonymity is a presentation rule enforced
 * in the serializer, never an absence of data.
 */
const communityPostSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    authorId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    authorResidentId: { ref: "Resident", type: Schema.Types.ObjectId },
    body: { maxlength: 4000, required: true, trim: true, type: String },
    mediaAssetIds: { default: [], type: [String] },
    isAnonymous: { default: false, type: Boolean },
    /** HOSTEL_ONLY keeps the post inside the author's hostel. */
    visibility: {
      default: "HOSTEL_ONLY",
      enum: ["PUBLIC", "HOSTEL_ONLY"],
      type: String,
    },
    /** Official announcements are posted by staff and pinned above the feed. */
    isAnnouncement: { default: false, type: Boolean },
    status: {
      default: "VISIBLE",
      enum: ["VISIBLE", "HIDDEN"],
      type: String,
    },
    hiddenAt: Date,
    hiddenBy: { ref: "User", type: Schema.Types.ObjectId },
    hiddenReason: { trim: true, type: String },
    reportCount: { default: 0, min: 0, type: Number },
    commentCount: { default: 0, min: 0, type: Number },
    reactionCount: { default: 0, min: 0, type: Number },
  },
  { timestamps: true },
);

communityPostSchema.index({ hostelId: 1, status: 1, createdAt: -1 });
communityPostSchema.index({ visibility: 1, status: 1, createdAt: -1 });
communityPostSchema.index({ authorId: 1, createdAt: -1 });

export const CommunityPostModel =
  models.CommunityPost || model("CommunityPost", communityPostSchema);
