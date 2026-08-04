import { Schema, model, models } from "mongoose";

/**
 * A post on the platform-wide community at `/community`.
 *
 * Every post belongs to exactly one *space*, and the space is never chosen by
 * the author — it is decided by who they are at the moment they post. Someone
 * with no hostel membership posts into the public space; a resident posts into
 * their hostel's space. What the author *does* choose is who may read it
 * (`visibility`), and only a hostel post has a meaningful choice to make.
 */
const communityMediaSchema = new Schema(
  {
    assetId: { required: true, type: String },
    kind: { enum: ["IMAGE", "VIDEO"], required: true, type: String },
  },
  { _id: false },
);

const communityPostSchema = new Schema(
  {
    /** PUBLIC posts carry no `hostelId`; HOSTEL posts always do. */
    spaceType: {
      default: "PUBLIC",
      enum: ["PUBLIC", "HOSTEL"],
      required: true,
      type: String,
    },
    hostelId: { default: null, ref: "Hostel", type: Schema.Types.ObjectId },
    /**
     * Null only after the author's account is purged (ARCHITECTURE.md §13.2) —
     * the post survives because it is part of a conversation other people took
     * part in, but the authorship link is cut. Not optional in any other
     * situation; `community.service.ts` always supplies it.
     */
    authorId: { default: null, ref: "User", type: Schema.Types.ObjectId },
    authorResidentId: { ref: "Resident", type: Schema.Types.ObjectId },
    body: { maxlength: 4000, required: true, trim: true, type: String },
    media: { default: [], type: [communityMediaSchema] },
    /**
     * HOSTEL_ONLY keeps a hostel post inside that hostel. Meaningless on a
     * public-space post, which has no smaller audience to fall back to.
     */
    visibility: {
      default: "PUBLIC",
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
    /**
     * Set when the post enters a moderation queue — either because enough
     * distinct people reported it or because the automated check judged the
     * reports credible. Cleared when a moderator resolves it. The post stays
     * VISIBLE while flagged: a queue entry is a request for a human to look,
     * not a verdict.
     */
    flaggedAt: Date,
    flaggedReason: { trim: true, type: String },
    reportCount: { default: 0, min: 0, type: Number },
    commentCount: { default: 0, min: 0, type: Number },
    reactionCount: { default: 0, min: 0, type: Number },
    /**
     * Seeded sample content, same flag the demo users and hostels carry. Set
     * only by `scripts/seed-community-posts.mjs`, which is also the only thing
     * that deletes by it — nothing in the app reads or writes it.
     */
    isDemoData: { default: false, type: Boolean },
  },
  { timestamps: true },
);

communityPostSchema.index({ hostelId: 1, status: 1, createdAt: -1 });
communityPostSchema.index({ spaceType: 1, visibility: 1, status: 1, createdAt: -1 });
communityPostSchema.index({ authorId: 1, createdAt: -1 });
// The moderation queues read "flagged, newest first" in both portals.
communityPostSchema.index({ flaggedAt: -1 });

export const CommunityPostModel =
  models.CommunityPost || model("CommunityPost", communityPostSchema);
