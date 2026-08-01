import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { assertHostelAccess } from "@/lib/tenant";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { CommunityCommentModel } from "@hostel/db/models/CommunityComment";
import { CommunityPostModel } from "@hostel/db/models/CommunityPost";
import { CommunityReactionModel } from "@hostel/db/models/CommunityReaction";
import { CommunityReportModel } from "@hostel/db/models/CommunityReport";
import { createInAppNotification } from "@/modules/notifications/notification.service";
import { maskProfanity } from "@/modules/community/profanity";
import { UserModel } from "@hostel/db/models/User";
import {
  findCurrentResident,
  normalizeObjectId,
} from "@/modules/residents/resident-access";
import type {
  communityAnnouncementSchema,
  communityCommentCreateSchema,
  communityFeedQuerySchema,
  communityHideSchema,
  communityModerationQuerySchema,
  communityPostCreateSchema,
  communityReactionSchema,
  communityReportSchema,
} from "@/modules/community/community.validation";

type PostCreateInput = z.infer<typeof communityPostCreateSchema>;
type FeedQuery = z.infer<typeof communityFeedQuerySchema>;
type CommentCreateInput = z.infer<typeof communityCommentCreateSchema>;
type ReactionInput = z.infer<typeof communityReactionSchema>;
type ReportInput = z.infer<typeof communityReportSchema>;
type ModerationQuery = z.infer<typeof communityModerationQuerySchema>;
type HideInput = z.infer<typeof communityHideSchema>;
type AnnouncementInput = z.infer<typeof communityAnnouncementSchema>;

type PostRecord = {
  _id: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  commentCount: number;
  createdAt?: Date;
  hiddenReason?: string;
  hostelId: Types.ObjectId;
  isAnnouncement: boolean;
  isAnonymous: boolean;
  mediaAssetIds: string[];
  reactionCount: number;
  reportCount: number;
  status: "VISIBLE" | "HIDDEN";
  visibility: "PUBLIC" | "HOSTEL_ONLY";
};

type CommentRecord = {
  _id: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  createdAt?: Date;
  isAnonymous: boolean;
  postId: Types.ObjectId;
  status: "VISIBLE" | "HIDDEN";
};

export class CommunityServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "COMMUNITY_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

function resolveAdminHostelId(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);

    return normalizeObjectId(requestedHostelId, "hostel id");
  }

  if (principal.hostelIds.length === 1) {
    return normalizeObjectId(principal.hostelIds[0], "hostel id");
  }

  throw new CommunityServiceError(
    "A hostelId is required for this hostel admin action.",
    "HOSTEL_SCOPE_REQUIRED",
    422,
  );
}

async function namesByUserId(userIds: Types.ObjectId[]) {
  if (userIds.length === 0) {
    return new Map<string, string>();
  }

  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("name")
    .lean<Array<{ _id: Types.ObjectId; name?: string }>>();

  return new Map(users.map((user) => [user._id.toString(), user.name ?? "Resident"]));
}

/**
 * Anonymity is applied here and only here. An anonymous post keeps its
 * `authorId` in the database for moderation, but the author's name never
 * reaches a reader — including the reader's own "is this mine" check, which is
 * answered by comparing ids server-side rather than by exposing the id.
 */
function serializePost(
  post: PostRecord,
  options: {
    authorName?: string;
    isModeratorView?: boolean;
    viewerReaction?: string;
    viewerUserId?: string;
  } = {},
) {
  const anonymous = post.isAnonymous && !options.isModeratorView;

  return {
    authorName: anonymous ? "Anonymous Resident" : (options.authorName ?? "Resident"),
    body: post.body,
    commentCount: post.commentCount,
    createdAt: post.createdAt?.toISOString(),
    hiddenReason: options.isModeratorView ? post.hiddenReason : undefined,
    id: post._id.toString(),
    isAnnouncement: post.isAnnouncement,
    isAnonymous: post.isAnonymous,
    isMine: options.viewerUserId === post.authorId.toString(),
    mediaAssetIds: post.mediaAssetIds,
    reactionCount: post.reactionCount,
    reportCount: options.isModeratorView ? post.reportCount : undefined,
    status: post.status,
    viewerReaction: options.viewerReaction ?? null,
    visibility: post.visibility,
  };
}

function serializeComment(comment: CommentRecord, authorName?: string) {
  return {
    authorName: comment.isAnonymous ? "Anonymous Resident" : (authorName ?? "Resident"),
    body: comment.body,
    createdAt: comment.createdAt?.toISOString(),
    id: comment._id.toString(),
    isAnonymous: comment.isAnonymous,
  };
}

export async function createCommunityPost(
  input: PostCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const post = (await CommunityPostModel.create({
    authorId: principal.userId,
    authorResidentId: resident._id,
    body: maskProfanity(input.body),
    hostelId: resident.hostelId,
    isAnonymous: input.isAnonymous,
    mediaAssetIds: input.mediaAssetIds,
    status: "VISIBLE",
    visibility: input.visibility,
  })) as PostRecord;

  return {
    post: serializePost(post, { viewerUserId: principal.userId }),
  };
}

/**
 * The feed a resident sees: their own hostel's visible posts, announcements
 * first. Cross-hostel PUBLIC posts are deliberately not mixed in — a resident
 * opening "Community" expects their building, not a national timeline.
 */
export async function listCommunityFeed(query: FeedQuery, principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const filter: Record<string, unknown> = {
    hostelId: resident.hostelId,
    status: "VISIBLE",
  };

  if (query.scope === "mine") {
    filter.authorId = normalizeObjectId(principal.userId, "user id");
  }

  const posts = await CommunityPostModel.find(filter)
    .sort({ isAnnouncement: -1, createdAt: -1 })
    .limit(100)
    .lean<PostRecord[]>();

  const [names, reactions] = await Promise.all([
    namesByUserId(
      posts.filter((post) => !post.isAnonymous).map((post) => post.authorId),
    ),
    CommunityReactionModel.find({
      postId: { $in: posts.map((post) => post._id) },
      userId: normalizeObjectId(principal.userId, "user id"),
    }).lean<Array<{ postId: Types.ObjectId; type: string }>>(),
  ]);
  const reactionByPostId = new Map(
    reactions.map((reaction) => [reaction.postId.toString(), reaction.type]),
  );

  return {
    posts: posts.map((post) =>
      serializePost(post, {
        authorName: names.get(post.authorId.toString()),
        viewerReaction: reactionByPostId.get(post._id.toString()),
        viewerUserId: principal.userId,
      }),
    ),
  };
}

async function findVisiblePostForResident(postId: string, hostelId: Types.ObjectId) {
  const post = await CommunityPostModel.findOne({
    _id: normalizeObjectId(postId, "post id"),
    hostelId,
    status: "VISIBLE",
  }).lean<PostRecord | null>();

  if (!post) {
    throw new CommunityServiceError("Post was not found.", "POST_NOT_FOUND", 404);
  }

  return post;
}

export async function listPostComments(postId: string, principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const post = await findVisiblePostForResident(postId, resident.hostelId);
  const comments = await CommunityCommentModel.find({
    postId: post._id,
    status: "VISIBLE",
  })
    .sort({ createdAt: 1 })
    .limit(200)
    .lean<CommentRecord[]>();
  const names = await namesByUserId(
    comments.filter((comment) => !comment.isAnonymous).map((comment) => comment.authorId),
  );

  return {
    comments: comments.map((comment) =>
      serializeComment(comment, names.get(comment.authorId.toString())),
    ),
  };
}

export async function commentOnPost(
  postId: string,
  input: CommentCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const post = await findVisiblePostForResident(postId, resident.hostelId);
  const comment = (await CommunityCommentModel.create({
    authorId: principal.userId,
    body: maskProfanity(input.body),
    hostelId: resident.hostelId,
    isAnonymous: input.isAnonymous,
    postId: post._id,
    status: "VISIBLE",
  })) as CommentRecord;

  await CommunityPostModel.updateOne({ _id: post._id }, { $inc: { commentCount: 1 } });

  // Tell the author someone replied — unless they replied to themselves, and
  // never in a way that names an anonymous commenter.
  if (post.authorId.toString() !== principal.userId) {
    try {
      await createInAppNotification({
        body: "Someone commented on your community post.",
        category: "COMMUNITY",
        data: { postId: post._id.toString() },
        hostelId: resident.hostelId.toString(),
        title: "New comment",
        userId: post.authorId.toString(),
      });
    } catch {
      // Engagement notifications never block the comment itself.
    }
  }

  return { comment: serializeComment(comment) };
}

/** Toggle semantics: the same reaction twice removes it. */
export async function reactToPost(
  postId: string,
  input: ReactionInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const post = await findVisiblePostForResident(postId, resident.hostelId);
  const userId = normalizeObjectId(principal.userId, "user id");
  const existing = await CommunityReactionModel.findOne({
    postId: post._id,
    userId,
  }).lean<{ _id: Types.ObjectId; type: string } | null>();

  if (existing?.type === input.type) {
    await CommunityReactionModel.deleteOne({ _id: existing._id });
    await CommunityPostModel.updateOne(
      { _id: post._id },
      { $inc: { reactionCount: -1 } },
    );

    return { reaction: null };
  }

  await CommunityReactionModel.updateOne(
    { postId: post._id, userId },
    { $set: { hostelId: resident.hostelId, type: input.type } },
    { upsert: true },
  );

  if (!existing) {
    await CommunityPostModel.updateOne({ _id: post._id }, { $inc: { reactionCount: 1 } });
  }

  return { reaction: input.type };
}

export async function reportPost(
  postId: string,
  input: ReportInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const post = await findVisiblePostForResident(postId, resident.hostelId);
  const existing = await CommunityReportModel.findOne({
    postId: post._id,
    reportedBy: normalizeObjectId(principal.userId, "user id"),
  }).lean<{ _id: Types.ObjectId } | null>();

  if (existing) {
    return { reported: true };
  }

  await CommunityReportModel.create({
    hostelId: resident.hostelId,
    postId: post._id,
    reason: input.reason,
    reportedBy: principal.userId,
    status: "OPEN",
  });
  await CommunityPostModel.updateOne({ _id: post._id }, { $inc: { reportCount: 1 } });

  return { reported: true };
}

export async function deleteOwnPost(postId: string, principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const result = await CommunityPostModel.updateOne(
    {
      _id: normalizeObjectId(postId, "post id"),
      authorId: normalizeObjectId(principal.userId, "user id"),
      hostelId: resident.hostelId,
    },
    { $set: { hiddenAt: new Date(), hiddenReason: "Removed by author", status: "HIDDEN" } },
  );

  if (result.matchedCount === 0) {
    throw new CommunityServiceError("Post was not found.", "POST_NOT_FOUND", 404);
  }

  return { postId, status: "HIDDEN" as const };
}

/* -------------------------------------------------------------------------- */
/* Hostel admin moderation                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Moderator view. Anonymity is lifted here — an admin dealing with abuse has to
 * know who posted — and every unmasking is a deliberate, audited read of their
 * own hostel's feed only.
 */
export async function listCommunityForModeration(
  query: ModerationQuery,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, query.hostelId);
  const filter: Record<string, unknown> = { hostelId };

  if (query.status) {
    filter.status = query.status;
  }

  const posts = await CommunityPostModel.find(filter)
    .sort({ reportCount: -1, createdAt: -1 })
    .limit(200)
    .lean<PostRecord[]>();
  const names = await namesByUserId(posts.map((post) => post.authorId));

  return {
    posts: posts.map((post) =>
      serializePost(post, {
        authorName: names.get(post.authorId.toString()),
        isModeratorView: true,
      }),
    ),
    summary: {
      hidden: posts.filter((post) => post.status === "HIDDEN").length,
      reported: posts.filter((post) => post.reportCount > 0).length,
      total: posts.length,
    },
  };
}

export async function hideCommunityPost(
  postId: string,
  input: HideInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, input.hostelId);
  const post = await CommunityPostModel.findOneAndUpdate(
    { _id: normalizeObjectId(postId, "post id"), hostelId },
    {
      $set: {
        hiddenAt: new Date(),
        hiddenBy: principal.userId,
        hiddenReason: input.reason,
        status: "HIDDEN",
      },
    },
    { new: true },
  ).lean<PostRecord | null>();

  if (!post) {
    throw new CommunityServiceError("Post was not found.", "POST_NOT_FOUND", 404);
  }

  await Promise.all([
    CommunityReportModel.updateMany(
      { postId: post._id, status: "OPEN" },
      { $set: { reviewedAt: new Date(), reviewedBy: principal.userId, status: "ACTIONED" } },
    ),
    AuditLogModel.create({
      action: "COMMUNITY_POST_HIDDEN",
      actorId: principal.userId,
      entityId: post._id.toString(),
      entityType: "CommunityPost",
      hostelId,
      metadata: { reason: input.reason },
    }),
  ]);

  return { post: serializePost(post, { isModeratorView: true }) };
}

export async function unhideCommunityPost(
  postId: string,
  input: HideInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, input.hostelId);
  const post = await CommunityPostModel.findOneAndUpdate(
    { _id: normalizeObjectId(postId, "post id"), hostelId },
    {
      $set: { status: "VISIBLE" },
      $unset: { hiddenAt: "", hiddenBy: "", hiddenReason: "" },
    },
    { new: true },
  ).lean<PostRecord | null>();

  if (!post) {
    throw new CommunityServiceError("Post was not found.", "POST_NOT_FOUND", 404);
  }

  await Promise.all([
    CommunityReportModel.updateMany(
      { postId: post._id, status: "OPEN" },
      {
        $set: {
          reviewedAt: new Date(),
          reviewedBy: principal.userId,
          status: "DISMISSED",
        },
      },
    ),
    AuditLogModel.create({
      action: "COMMUNITY_POST_RESTORED",
      actorId: principal.userId,
      entityId: post._id.toString(),
      entityType: "CommunityPost",
      hostelId,
      metadata: { reason: input.reason },
    }),
  ]);

  return { post: serializePost(post, { isModeratorView: true }) };
}

/** Staff post an official announcement, pinned above the resident feed. */
export async function createCommunityAnnouncement(
  input: AnnouncementInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, input.hostelId);
  const post = (await CommunityPostModel.create({
    authorId: principal.userId,
    body: input.body,
    hostelId,
    isAnnouncement: true,
    isAnonymous: false,
    status: "VISIBLE",
    visibility: "HOSTEL_ONLY",
  })) as PostRecord;

  return { post: serializePost(post, { isModeratorView: true }) };
}
