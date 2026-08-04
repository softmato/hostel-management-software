import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import {
  MAX_PAGE_SIZE,
  paginationMeta,
  paginationRange,
  type PaginationQuery,
} from "@/lib/pagination";
import { Role } from "@/lib/roles";
import { assertHostelAccess } from "@/lib/tenant";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { CommunityCommentModel } from "@hostel/db/models/CommunityComment";
import { CommunityCommentVoteModel } from "@hostel/db/models/CommunityCommentVote";
import { CommunityPostModel } from "@hostel/db/models/CommunityPost";
import { CommunityReactionModel } from "@hostel/db/models/CommunityReaction";
import { CommunityReportModel } from "@hostel/db/models/CommunityReport";
import { HostelModel } from "@hostel/db/models/Hostel";
import {
  createInAppNotification,
  createOrUpdateBatchedNotification,
} from "@/modules/notifications/notification.service";
import { getCommunitySettings } from "@/modules/community/community-settings";
import {
  REPORT_QUEUE_THRESHOLD,
  triageReportedPost,
} from "@/modules/community/community-triage";
import { maskProfanity } from "@/modules/community/profanity";
import { UserModel } from "@hostel/db/models/User";
import { normalizeObjectId } from "@/modules/residents/resident-access";
import type {
  communityAnnouncementSchema,
  communityCommentCreateSchema,
  communityFeedQuerySchema,
  communityHideSchema,
  communityModerationQuerySchema,
  communityPostCreateSchema,
  communityReactionSchema,
  communityReportSchema,
  communityVoteSchema,
} from "@/modules/community/community.validation";

type PostCreateInput = z.infer<typeof communityPostCreateSchema>;
type FeedQuery = z.infer<typeof communityFeedQuerySchema>;
type CommentCreateInput = z.infer<typeof communityCommentCreateSchema>;
type ReactionInput = z.infer<typeof communityReactionSchema>;
type ReportInput = z.infer<typeof communityReportSchema>;
type ModerationQuery = z.infer<typeof communityModerationQuerySchema>;
type HideInput = z.infer<typeof communityHideSchema>;
type AnnouncementInput = z.infer<typeof communityAnnouncementSchema>;
type VoteInput = z.infer<typeof communityVoteSchema>;

type PostMedia = { assetId: string; kind: "IMAGE" | "VIDEO" };

type PostRecord = {
  _id: Types.ObjectId;
  /** Null once the author's account has been purged (ARCHITECTURE.md §13.2). */
  authorId: Types.ObjectId | null;
  body: string;
  commentCount: number;
  createdAt?: Date;
  flaggedAt?: Date;
  flaggedReason?: string;
  hiddenReason?: string;
  hostelId: Types.ObjectId | null;
  isAnnouncement: boolean;
  media?: PostMedia[];
  /** Pre-`media` rows stored bare asset ids and were always images. */
  mediaAssetIds?: string[];
  reactionCount: number;
  reportCount: number;
  spaceType: "PUBLIC" | "HOSTEL";
  status: "VISIBLE" | "HIDDEN";
  visibility: "PUBLIC" | "HOSTEL_ONLY";
};

type CommentRecord = {
  _id: Types.ObjectId;
  /** Null once the author's account has been purged (ARCHITECTURE.md §13.2). */
  authorId: Types.ObjectId | null;
  body: string;
  createdAt?: Date;
  parentId?: Types.ObjectId | null;
  postId: Types.ObjectId;
  score?: number;
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

/* -------------------------------------------------------------------------- */
/* Spaces and visibility                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where this account's posts land. The author never chooses: someone with no
 * hostel behind their account writes into the public space, and anyone attached
 * to a hostel writes into that hostel's space. An account attached to several
 * hostels (a group's admin) may name which one.
 */
function resolveAuthorSpace(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);

    return {
      hostelId: normalizeObjectId(requestedHostelId, "hostel id"),
      spaceType: "HOSTEL" as const,
    };
  }

  const [hostelId] = principal.hostelIds;

  if (!hostelId) {
    return { hostelId: null, spaceType: "PUBLIC" as const };
  }

  return {
    hostelId: normalizeObjectId(hostelId, "hostel id"),
    spaceType: "HOSTEL" as const,
  };
}

function viewerHostelIds(principal: ApiPrincipal | null) {
  return (principal?.hostelIds ?? []).filter((hostelId) =>
    Types.ObjectId.isValid(hostelId),
  );
}

function isPlatformRole(principal: ApiPrincipal | null) {
  return (
    principal?.role === Role.SUPERADMIN || principal?.role === Role.PLATFORM_MODERATOR
  );
}

/**
 * The one rule that decides what a reader may see, expressed as a Mongo filter
 * so it can never drift from the rule applied when reading a single post.
 *
 * Everyone — signed out included — sees public-space posts and the hostel posts
 * whose author chose PUBLIC. A HOSTEL_ONLY post is visible only to accounts
 * attached to that hostel. Platform moderators see everything, because their
 * job is the posts nobody else is meant to be handling.
 */
function readableFilter(principal: ApiPrincipal | null): Record<string, unknown> {
  if (isPlatformRole(principal)) {
    return {};
  }

  const hostelIds = viewerHostelIds(principal).map((id) => new Types.ObjectId(id));

  return {
    $or: [
      { visibility: "PUBLIC" },
      ...(hostelIds.length > 0 ? [{ hostelId: { $in: hostelIds } }] : []),
    ],
  };
}

/**
 * Case-insensitive substring match on the post body.
 *
 * A regex, not a `$text` index: the corpus is small, the searches are short,
 * and `$text` cannot match a partial word — someone typing "banesh" expects
 * Baneshwor back. Every metacharacter is escaped, so a query of "c++" or ".*"
 * searches for that string rather than becoming one.
 */
function searchPattern(query: string) {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function spaceFilter(space: FeedQuery["space"], principal: ApiPrincipal | null) {
  if (space === "all") {
    return {};
  }

  if (space === "public") {
    return { spaceType: "PUBLIC" };
  }

  if (space === "mine") {
    const hostelIds = viewerHostelIds(principal).map((id) => new Types.ObjectId(id));

    // Signed out, or signed in with no hostel: "my hostel" is an empty feed
    // rather than an accidental view of everyone's.
    return { hostelId: { $in: hostelIds } };
  }

  return { hostelId: new Types.ObjectId(space) };
}

/* -------------------------------------------------------------------------- */
/* Serialization                                                              */
/* -------------------------------------------------------------------------- */

async function namesByUserId(ids: Array<Types.ObjectId | null>) {
  const userIds = ids.filter((id): id is Types.ObjectId => Boolean(id));

  if (userIds.length === 0) {
    return new Map<string, { image?: string; name: string }>();
  }

  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("name image")
    .lean<Array<{ _id: Types.ObjectId; image?: string; name?: string }>>();

  return new Map(
    users.map((user) => [
      user._id.toString(),
      { image: user.image, name: user.name ?? "Member" },
    ]),
  );
}

async function hostelNamesByIds(ids: Array<Types.ObjectId | null>) {
  const hostelIds = ids.filter((id): id is Types.ObjectId => Boolean(id));

  if (hostelIds.length === 0) {
    return new Map<string, string>();
  }

  const hostels = await HostelModel.find({ _id: { $in: hostelIds } })
    .select("name slug")
    .lean<Array<{ _id: Types.ObjectId; name?: string; slug?: string }>>();

  return new Map(
    hostels.map((hostel) => [hostel._id.toString(), hostel.name ?? "Hostel"]),
  );
}

/** Pre-`media` rows kept bare asset ids and only ever held images. */
function postMedia(post: PostRecord): PostMedia[] {
  if (post.media && post.media.length > 0) {
    return post.media;
  }

  return (post.mediaAssetIds ?? []).map((assetId) => ({
    assetId,
    kind: "IMAGE" as const,
  }));
}

function serializePost(
  post: PostRecord,
  options: {
    author?: { image?: string; name: string };
    hostelName?: string;
    isModeratorView?: boolean;
    viewerReaction?: string;
    viewerUserId?: string;
  } = {},
) {
  return {
    authorImage: post.authorId ? (options.author?.image ?? null) : null,
    // A purged account leaves the post standing but takes the name with it.
    authorName: post.authorId ? (options.author?.name ?? "Member") : "Former member",
    body: post.body,
    commentCount: post.commentCount,
    createdAt: post.createdAt?.toISOString(),
    flaggedAt: options.isModeratorView ? post.flaggedAt?.toISOString() : undefined,
    flaggedReason: options.isModeratorView ? post.flaggedReason : undefined,
    hiddenReason: options.isModeratorView ? post.hiddenReason : undefined,
    hostelId: post.hostelId?.toString() ?? null,
    hostelName: post.hostelId ? (options.hostelName ?? "Hostel") : null,
    id: post._id.toString(),
    isAnnouncement: post.isAnnouncement,
    isMine: Boolean(post.authorId) && options.viewerUserId === post.authorId?.toString(),
    media: postMedia(post),
    reactionCount: post.reactionCount,
    reportCount: options.isModeratorView ? post.reportCount : undefined,
    spaceType: post.spaceType,
    status: post.status,
    viewerReaction: options.viewerReaction ?? null,
    visibility: post.visibility,
  };
}

function serializeComment(
  comment: CommentRecord,
  options: {
    author?: { image?: string; name: string };
    viewerUserId?: string;
    viewerVote?: number;
  } = {},
) {
  return {
    authorImage: comment.authorId ? (options.author?.image ?? null) : null,
    authorName: comment.authorId ? (options.author?.name ?? "Member") : "Former member",
    body: comment.body,
    createdAt: comment.createdAt?.toISOString(),
    id: comment._id.toString(),
    isMine:
      Boolean(comment.authorId) && options.viewerUserId === comment.authorId?.toString(),
    parentId: comment.parentId?.toString() ?? null,
    score: comment.score ?? 0,
    viewerVote: options.viewerVote ?? 0,
  };
}

/**
 * Attach author names, hostel names and the viewer's own reaction to a page of
 * posts in three queries rather than three per post.
 */
async function decoratePosts(
  posts: PostRecord[],
  principal: ApiPrincipal | null,
  isModeratorView = false,
) {
  const [names, hostelNames, reactions] = await Promise.all([
    namesByUserId(posts.map((post) => post.authorId)),
    hostelNamesByIds(posts.map((post) => post.hostelId)),
    principal
      ? CommunityReactionModel.find({
          postId: { $in: posts.map((post) => post._id) },
          userId: normalizeObjectId(principal.userId, "user id"),
        }).lean<Array<{ postId: Types.ObjectId; type: string }>>()
      : Promise.resolve([]),
  ]);
  const reactionByPostId = new Map(
    reactions.map((reaction) => [reaction.postId.toString(), reaction.type]),
  );

  return posts.map((post) =>
    serializePost(post, {
      author: post.authorId ? names.get(post.authorId.toString()) : undefined,
      hostelName: post.hostelId ? hostelNames.get(post.hostelId.toString()) : undefined,
      isModeratorView,
      viewerReaction: reactionByPostId.get(post._id.toString()),
      viewerUserId: principal?.userId,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The `/community` feed. Open to signed-out readers, which is the whole point
 * of moving the community out of the portals — someone deciding whether to
 * trust a hostel can read what the people living there actually say.
 */
export async function listCommunityFeed(
  query: FeedQuery,
  principal: ApiPrincipal | null,
) {
  await connectToDatabase();

  const filter = {
    $and: [
      { status: "VISIBLE" },
      readableFilter(principal),
      spaceFilter(query.space, principal),
      ...(query.q ? [{ body: searchPattern(query.q) }] : []),
    ],
  };
  const { limit, skip } = paginationRange(query);
  // "Top" is engagement-ordered, but still recency-broken so a months-old post
  // with 40 reactions cannot sit permanently at the head of the feed.
  const sort: Record<string, 1 | -1> =
    query.sort === "top"
      ? { reactionCount: -1, commentCount: -1, createdAt: -1 }
      : { createdAt: -1 };

  const [posts, total] = await Promise.all([
    CommunityPostModel.find(filter)
      .sort({ isAnnouncement: -1, ...sort })
      .skip(skip)
      .limit(limit)
      .lean<PostRecord[]>(),
    CommunityPostModel.countDocuments(filter),
  ]);

  return {
    pagination: paginationMeta(query, total),
    posts: await decoratePosts(posts, principal),
  };
}

/**
 * The spaces a reader can switch between: the public space, plus every hostel
 * that has actually posted something they are allowed to see. A hostel with no
 * readable posts is not offered as a tab that leads to an empty room.
 *
 * Also answers "where would *I* post" — the composer has to say which space a
 * post is about to land in before it lands there, and only the server knows.
 */
export async function listCommunitySpaces(principal: ApiPrincipal | null) {
  await connectToDatabase();

  const authorSpace = principal ? resolveAuthorSpace(principal) : null;
  const authorHostelName = authorSpace?.hostelId
    ? ((await hostelNamesByIds([authorSpace.hostelId])).get(
        authorSpace.hostelId.toString(),
      ) ?? "Hostel")
    : null;

  const rows = await CommunityPostModel.aggregate<{
    _id: Types.ObjectId | null;
    count: number;
  }>([
    {
      $match: {
        $and: [
          { status: "VISIBLE" },
          readableFilter(principal),
          { spaceType: "HOSTEL" },
        ],
      },
    },
    { $group: { _id: "$hostelId", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 50 },
  ]);
  const names = await hostelNamesByIds(rows.map((row) => row._id));
  const memberHostelIds = new Set(viewerHostelIds(principal));

  const publicCount = await CommunityPostModel.countDocuments({
    spaceType: "PUBLIC",
    status: "VISIBLE",
  });

  return {
    spaces: [
      { id: "public", isMine: false, name: "Public", postCount: publicCount },
      ...rows.map((row) => ({
        id: row._id?.toString() ?? "public",
        isMine: memberHostelIds.has(row._id?.toString() ?? ""),
        name: names.get(row._id?.toString() ?? "") ?? "Hostel",
        postCount: row.count,
      })),
    ],
    viewer: {
      canPost: Boolean(principal),
      hostelId: authorSpace?.hostelId?.toString() ?? null,
      hostelName: authorHostelName,
      spaceType: authorSpace?.spaceType ?? null,
    },
  };
}

/** Loads a post the reader is allowed to see, or throws a plain 404. */
async function findReadablePost(postId: string, principal: ApiPrincipal | null) {
  const post = await CommunityPostModel.findOne({
    $and: [
      { _id: normalizeObjectId(postId, "post id"), status: "VISIBLE" },
      readableFilter(principal),
    ],
  }).lean<PostRecord | null>();

  if (!post) {
    // A post the reader may not see is reported exactly like one that does not
    // exist (RULES.md §3) — the 404 must not confirm a HOSTEL_ONLY post is there.
    throw new CommunityServiceError("Post was not found.", "POST_NOT_FOUND", 404);
  }

  return post;
}

/** Single post, for the permalink a "share" link points at. */
export async function getCommunityPost(postId: string, principal: ApiPrincipal | null) {
  await connectToDatabase();

  const post = await findReadablePost(postId, principal);
  const [decorated] = await decoratePosts([post], principal);

  return { post: decorated };
}

/**
 * A post's whole comment tree, flat, in reading order: each comment is followed
 * by its replies, best-scoring first.
 *
 * Flattening happens here rather than in the browser so the order is the same
 * for everyone and a client cannot invent a nesting the server did not sanction.
 * `depth` is carried on each row, which is all the UI needs to draw the thread.
 */
export async function listPostComments(
  postId: string,
  principal: ApiPrincipal | null,
  query: PaginationQuery = { page: 1, pageSize: MAX_PAGE_SIZE },
) {
  await connectToDatabase();

  const post = await findReadablePost(postId, principal);
  const commentFilter = { postId: post._id, status: "VISIBLE" };

  // The tree is read whole — paginating it would cut replies away from the
  // comments they answer. `pageSize` caps the total instead.
  const { limit } = paginationRange(query);
  const comments = await CommunityCommentModel.find(commentFilter)
    .sort({ score: -1, createdAt: 1 })
    .limit(Math.max(limit, MAX_PAGE_SIZE))
    .lean<CommentRecord[]>();

  const [names, votes] = await Promise.all([
    namesByUserId(comments.map((comment) => comment.authorId)),
    principal
      ? CommunityCommentVoteModel.find({
          postId: post._id,
          userId: normalizeObjectId(principal.userId, "user id"),
        }).lean<Array<{ commentId: Types.ObjectId; value: number }>>()
      : Promise.resolve([]),
  ]);
  const voteByCommentId = new Map(
    votes.map((vote) => [vote.commentId.toString(), vote.value]),
  );

  const byParent = new Map<string, CommentRecord[]>();

  for (const comment of comments) {
    const key = comment.parentId?.toString() ?? "root";

    byParent.set(key, [...(byParent.get(key) ?? []), comment]);
  }

  const ordered: Array<ReturnType<typeof serializeComment> & { depth: number }> = [];

  // Depth is capped for *display* only — a deeper reply still renders, it just
  // stops indenting, so a long argument cannot squeeze the text to nothing.
  const walk = (parentKey: string, depth: number) => {
    for (const comment of byParent.get(parentKey) ?? []) {
      ordered.push({
        ...serializeComment(comment, {
          author: comment.authorId ? names.get(comment.authorId.toString()) : undefined,
          viewerUserId: principal?.userId,
          viewerVote: voteByCommentId.get(comment._id.toString()),
        }),
        depth: Math.min(depth, 5),
      });
      walk(comment._id.toString(), depth + 1);
    }
  };

  walk("root", 0);

  return {
    comments: ordered,
    pagination: paginationMeta(
      { ...query, pageSize: Math.max(limit, MAX_PAGE_SIZE) },
      ordered.length,
    ),
  };
}

/**
 * Up/down vote a comment, or clear the caller's vote with `0`.
 *
 * The stored `score` is recomputed by summing the vote rows rather than being
 * incremented, so a double-submit or a lost response cannot drift it away from
 * the votes people actually cast.
 */
export async function voteOnComment(
  postId: string,
  commentId: string,
  input: VoteInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const post = await findReadablePost(postId, principal);
  const comment = await CommunityCommentModel.findOne({
    _id: normalizeObjectId(commentId, "comment id"),
    postId: post._id,
    status: "VISIBLE",
  }).lean<CommentRecord | null>();

  if (!comment) {
    throw new CommunityServiceError("Comment was not found.", "COMMENT_NOT_FOUND", 404);
  }

  const userId = normalizeObjectId(principal.userId, "user id");

  if (input.value === 0) {
    await CommunityCommentVoteModel.deleteOne({ commentId: comment._id, userId });
  } else {
    await CommunityCommentVoteModel.updateOne(
      { commentId: comment._id, userId },
      { $set: { postId: post._id, value: input.value } },
      { upsert: true },
    );
  }

  const [totals] = await CommunityCommentVoteModel.aggregate<{ score: number }>([
    { $match: { commentId: comment._id } },
    { $group: { _id: null, score: { $sum: "$value" } } },
  ]);
  const score = totals?.score ?? 0;

  await CommunityCommentModel.updateOne({ _id: comment._id }, { $set: { score } });

  return { commentId, score, viewerVote: input.value };
}

/** `#hashtags` people are actually using, most used first. */
export async function listTrendingTags(principal: ApiPrincipal | null, limit = 6) {
  const posts = await CommunityPostModel.find({
    $and: [{ status: "VISIBLE" }, readableFilter(principal)],
  })
    .sort({ createdAt: -1 })
    // Recent posts only: "trending" that averages over all time is just "popular".
    .limit(200)
    .select("body")
    .lean<Array<{ body: string }>>();

  const counts = new Map<string, number>();

  for (const post of posts) {
    // Deduped per post, so one person spamming a tag ten times in one post
    // counts once.
    const tags = new Set(
      (post.body.match(/#[\p{L}\p{N}_]{2,30}/gu) ?? []).map((tag) => tag.toLowerCase()),
    );

    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag, count]) => ({ count, tag }));
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

export async function createCommunityPost(
  input: PostCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const space = resolveAuthorSpace(principal);
  // A hostel that switched its community off silences its own space; it does
  // not push those residents into the public one.
  const settings = space.hostelId ? await getCommunitySettings(space.hostelId) : null;

  if (settings && !settings.enabled) {
    throw new CommunityServiceError(
      "The community feed is turned off for this hostel.",
      "COMMUNITY_DISABLED",
      403,
    );
  }

  const post = (await CommunityPostModel.create({
    authorId: principal.userId,
    body: settings?.profanityFilterEnabled ? maskProfanity(input.body) : input.body,
    hostelId: space.hostelId,
    media: input.media,
    spaceType: space.spaceType,
    status: "VISIBLE",
    // A public-space post has no smaller audience to be restricted to.
    visibility: space.spaceType === "PUBLIC" ? "PUBLIC" : input.visibility,
  })) as PostRecord;

  const [decorated] = await decoratePosts([post], principal);

  return { post: decorated };
}

export async function commentOnPost(
  postId: string,
  input: CommentCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const post = await findReadablePost(postId, principal);
  // A reply must answer a comment on *this* post — otherwise a crafted parentId
  // would graft a reply from one conversation onto another.
  const parentId = input.parentId
    ? ((
        await CommunityCommentModel.findOne({
          _id: normalizeObjectId(input.parentId, "comment id"),
          postId: post._id,
          status: "VISIBLE",
        }).lean<{ _id: Types.ObjectId } | null>()
      )?._id ?? null)
    : null;

  if (input.parentId && !parentId) {
    throw new CommunityServiceError(
      "The comment you replied to was not found.",
      "COMMENT_NOT_FOUND",
      404,
    );
  }

  const comment = (await CommunityCommentModel.create({
    authorId: principal.userId,
    body: maskProfanity(input.body),
    hostelId: post.hostelId,
    parentId,
    postId: post._id,
    score: 0,
    status: "VISIBLE",
  })) as CommentRecord;

  await CommunityPostModel.updateOne({ _id: post._id }, { $inc: { commentCount: 1 } });

  // A reply belongs to the person being replied to; only a top-level comment is
  // news for the post's author. Sending both would notify the author of every
  // message in an argument happening under their post.
  const recipientId = parentId
    ? (
        await CommunityCommentModel.findById(parentId)
          .select("authorId")
          .lean<{ authorId: Types.ObjectId | null } | null>()
      )?.authorId
    : post.authorId;

  // Nothing to send when they are talking to themselves, or the account has
  // been purged.
  if (recipientId && recipientId.toString() !== principal.userId) {
    try {
      await createInAppNotification({
        body: parentId
          ? "Someone replied to your comment."
          : "Someone commented on your community post.",
        category: "COMMUNITY",
        data: { postId: post._id.toString() },
        hostelId: post.hostelId?.toString(),
        title: parentId ? "New reply" : "New comment",
        userId: recipientId.toString(),
      });
    } catch {
      // Engagement notifications never block the comment itself.
    }
  }

  const names = await namesByUserId([comment.authorId]);

  return {
    comment: serializeComment(comment, {
      author: comment.authorId ? names.get(comment.authorId.toString()) : undefined,
      viewerUserId: principal.userId,
    }),
  };
}

/** Toggle semantics: the same reaction twice removes it. */
export async function reactToPost(
  postId: string,
  input: ReactionInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const post = await findReadablePost(postId, principal);
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
    { $set: { hostelId: post.hostelId, type: input.type } },
    { upsert: true },
  );

  if (!existing) {
    await CommunityPostModel.updateOne({ _id: post._id }, { $inc: { reactionCount: 1 } });
    await notifyPostReaction(post, principal.userId);
  }

  return { reaction: input.type };
}

/**
 * Tell the author their post got a reaction — batched into a single row per
 * post ("5 people reacted to your post") rather than one notification each,
 * which is what ARCHITECTURE §9.4 / RULES §14 / EMAIL_SYSTEM §8.1 ask for.
 *
 * Only called when a *new* reactor appears: switching LIKE → LOVE is the same
 * person, and un-reacting is not news. The count is read back from the post so
 * it reflects the true number of reactors, not how many times this ran.
 *
 * Never names the reactor. The audience for a post is now the whole platform,
 * and the author does not need to be handed a roster to know their post landed.
 */
async function notifyPostReaction(post: PostRecord, actorUserId: string) {
  // Nothing to send when the author is themselves, or has been purged.
  if (!post.authorId || post.authorId.toString() === actorUserId) {
    return;
  }

  try {
    const reactors = await CommunityReactionModel.countDocuments({ postId: post._id });

    await createOrUpdateBatchedNotification({
      body:
        reactors === 1
          ? "Someone reacted to your community post."
          : `${reactors} people reacted to your community post.`,
      category: "COMMUNITY",
      data: { postId: post._id.toString(), reactionCount: reactors },
      dedupeKey: `community-reaction:${post._id.toString()}`,
      hostelId: post.hostelId?.toString(),
      title: "New reaction",
      userId: post.authorId.toString(),
    });
  } catch {
    // Engagement notifications never block the reaction itself.
  }
}

/**
 * File a report and decide whether the post now needs a human.
 *
 * See {@link REPORT_QUEUE_THRESHOLD} for why one report is never enough on its
 * own, and why nothing here hides anything.
 */
export async function reportPost(
  postId: string,
  input: ReportInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const post = await findReadablePost(postId, principal);
  const existing = await CommunityReportModel.findOne({
    postId: post._id,
    reportedBy: normalizeObjectId(principal.userId, "user id"),
  }).lean<{ _id: Types.ObjectId } | null>();

  if (existing) {
    // Reporting twice is the same report, not two — and saying so would tell
    // the reporter nothing they can act on.
    return { reported: true };
  }

  await CommunityReportModel.create({
    hostelId: post.hostelId,
    postId: post._id,
    reason: input.reason,
    reportedBy: principal.userId,
    status: "OPEN",
  });
  const reportCount = post.reportCount + 1;

  await CommunityPostModel.updateOne({ _id: post._id }, { $inc: { reportCount: 1 } });

  if (!post.flaggedAt) {
    await queuePostIfWarranted(post, reportCount);
  }

  return { reported: true };
}

async function queuePostIfWarranted(post: PostRecord, reportCount: number) {
  if (reportCount >= REPORT_QUEUE_THRESHOLD) {
    await flagPost(post, `Reported by ${reportCount} people.`);

    return;
  }

  // Below the volume threshold the automated read is the only thing that can
  // queue a post. It is allowed to fail: `triageReportedPost` returns null when
  // no provider answers, and the report still stands for the next reporter to
  // push over the threshold.
  try {
    const reasons = await CommunityReportModel.find({ postId: post._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("reason")
      .lean<Array<{ reason: string }>>();
    const verdict = await triageReportedPost({
      body: post.body,
      reasons: reasons.map((report) => report.reason),
    });

    if (verdict?.shouldQueue) {
      await flagPost(post, verdict.reason);
    }
  } catch {
    // Triage is an accelerator, never a gate on the report being recorded.
  }
}

async function flagPost(post: PostRecord, reason: string) {
  await CommunityPostModel.updateOne(
    { _id: post._id },
    { $set: { flaggedAt: new Date(), flaggedReason: reason } },
  );
}

export async function deleteOwnPost(postId: string, principal: ApiPrincipal) {
  await connectToDatabase();

  const result = await CommunityPostModel.updateOne(
    {
      _id: normalizeObjectId(postId, "post id"),
      authorId: normalizeObjectId(principal.userId, "user id"),
    },
    {
      $set: { hiddenAt: new Date(), hiddenReason: "Removed by author", status: "HIDDEN" },
    },
  );

  if (result.matchedCount === 0) {
    throw new CommunityServiceError("Post was not found.", "POST_NOT_FOUND", 404);
  }

  return { postId, status: "HIDDEN" as const };
}

/* -------------------------------------------------------------------------- */
/* Moderation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What a moderator is allowed to act on. A hostel admin sees their own hostel's
 * posts and nothing else; a platform moderator sees every space, which is the
 * only way public-space posts get reviewed at all.
 */
function moderationScopeFilter(principal: ApiPrincipal, requestedHostelId?: string) {
  if (isPlatformRole(principal)) {
    return requestedHostelId
      ? { hostelId: normalizeObjectId(requestedHostelId, "hostel id") }
      : {};
  }

  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);

    return { hostelId: normalizeObjectId(requestedHostelId, "hostel id") };
  }

  const hostelIds = viewerHostelIds(principal).map((id) => new Types.ObjectId(id));

  if (hostelIds.length === 0) {
    throw new CommunityServiceError(
      "A hostelId is required for this hostel admin action.",
      "HOSTEL_SCOPE_REQUIRED",
      422,
    );
  }

  return { hostelId: { $in: hostelIds } };
}

/**
 * The moderation queue, read by both the hostel portal and the platform portal
 * through the same scope rule. Flagged posts first — they are the reason the
 * page exists.
 */
export async function listCommunityModeration(
  query: ModerationQuery,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const scope = moderationScopeFilter(principal, query.hostelId);
  const filterByName: Record<ModerationQuery["filter"], Record<string, unknown>> = {
    all: {},
    flagged: { flaggedAt: { $ne: null }, status: "VISIBLE" },
    hidden: { status: "HIDDEN" },
  };
  const filter = { ...scope, ...filterByName[query.filter] };
  const { limit, skip } = paginationRange(query);

  const [posts, total] = await Promise.all([
    CommunityPostModel.find(filter)
      .sort({ flaggedAt: -1, reportCount: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<PostRecord[]>(),
    CommunityPostModel.countDocuments(filter),
  ]);
  // Over the whole queue, not the page — a moderator needs to know how much
  // work is waiting, which is exactly what a page-scoped count cannot say.
  const [flagged, hidden] = await Promise.all([
    CommunityPostModel.countDocuments({
      ...scope,
      flaggedAt: { $ne: null },
      status: "VISIBLE",
    }),
    CommunityPostModel.countDocuments({ ...scope, status: "HIDDEN" }),
  ]);

  return {
    pagination: paginationMeta(query, total),
    posts: await decoratePosts(posts, principal, true),
    summary: { flagged, hidden, total },
  };
}

/** Loads a post inside the moderator's scope, or throws a plain 404. */
async function findModeratablePost(
  postId: string,
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  const post = await CommunityPostModel.findOne({
    ...moderationScopeFilter(principal, requestedHostelId),
    _id: normalizeObjectId(postId, "post id"),
  }).lean<PostRecord | null>();

  if (!post) {
    throw new CommunityServiceError("Post was not found.", "POST_NOT_FOUND", 404);
  }

  return post;
}

export async function hideCommunityPost(
  postId: string,
  input: HideInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const target = await findModeratablePost(postId, principal, input.hostelId);
  const post = (await CommunityPostModel.findOneAndUpdate(
    { _id: target._id },
    {
      $set: {
        hiddenAt: new Date(),
        hiddenBy: principal.userId,
        hiddenReason: input.reason,
        status: "HIDDEN",
      },
      // Resolved: it is off the queue because it is off the feed.
      $unset: { flaggedAt: "", flaggedReason: "" },
    },
    { new: true },
  ).lean<PostRecord | null>())!;

  await Promise.all([
    CommunityReportModel.updateMany(
      { postId: post._id, status: "OPEN" },
      {
        $set: {
          reviewedAt: new Date(),
          reviewedBy: principal.userId,
          status: "ACTIONED",
        },
      },
    ),
    AuditLogModel.create({
      action: "COMMUNITY_POST_HIDDEN",
      actorId: principal.userId,
      entityId: post._id.toString(),
      entityType: "CommunityPost",
      hostelId: post.hostelId,
      metadata: { reason: input.reason },
    }),
  ]);

  const [decorated] = await decoratePosts([post], principal, true);

  return { post: decorated };
}

/**
 * Restore a hidden post, or clear a flag without hiding anything — the "this is
 * fine" verdict, which is the one a queue needs most.
 */
export async function unhideCommunityPost(
  postId: string,
  input: HideInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const target = await findModeratablePost(postId, principal, input.hostelId);
  const post = (await CommunityPostModel.findOneAndUpdate(
    { _id: target._id },
    {
      $set: { status: "VISIBLE" },
      $unset: {
        flaggedAt: "",
        flaggedReason: "",
        hiddenAt: "",
        hiddenBy: "",
        hiddenReason: "",
      },
    },
    { new: true },
  ).lean<PostRecord | null>())!;

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
      hostelId: post.hostelId,
      metadata: { reason: input.reason },
    }),
  ]);

  const [decorated] = await decoratePosts([post], principal, true);

  return { post: decorated };
}

/** Staff post an official announcement, pinned above their hostel's space. */
export async function createCommunityAnnouncement(
  input: AnnouncementInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const space = resolveAuthorSpace(principal, input.hostelId);

  if (space.spaceType !== "HOSTEL") {
    throw new CommunityServiceError(
      "A hostelId is required for this hostel admin action.",
      "HOSTEL_SCOPE_REQUIRED",
      422,
    );
  }

  const post = (await CommunityPostModel.create({
    authorId: principal.userId,
    body: input.body,
    hostelId: space.hostelId,
    isAnnouncement: true,
    spaceType: "HOSTEL",
    status: "VISIBLE",
    visibility: "HOSTEL_ONLY",
  })) as PostRecord;

  const [decorated] = await decoratePosts([post], principal, true);

  return { post: decorated };
}
