/**
 * The platform-wide community — `/community` and its children.
 *
 * Typed off `serializePost`, `serializeComment` and `listCommunitySpaces` in
 * `apps/web/src/modules/community/community.service.ts`.
 *
 * ## Reading needs no account; writing does
 *
 * `GET /community` uses `loadApiPrincipal`, so a signed-out visitor gets the
 * public space plus every hostel post whose author chose `PUBLIC`. Every write
 * route uses `requireApiPrincipal`. `spaces.viewer.canPost` is the server's own
 * answer to "may I write", and the client should ask it rather than infer from
 * whether a token exists.
 *
 * ## Media is PUBLIC, and that is load-bearing
 *
 * The web uploads community attachments with `accessLevel: "PUBLIC"`. It has to:
 * a public post is read by people who are neither the asset's owner nor in the
 * author's hostel, and `files/[assetId]/url` default-denies precisely that. So
 * community media goes up with `uploadAsset(..., { accessLevel: "PUBLIC" })` and
 * reads back through a plain URL with **no** bearer token — the opposite of a
 * complaint attachment.
 *
 * ## There is no anonymous post
 *
 * `communityPostCreateSchema` is `{ body, visibility, media }`. No `isAnonymous`
 * field exists on the schema or the model, so no toggle is drawn — see
 * `docs/MOBILE_APP_PHASES.md` §M5.
 */

import { API_BASE_URL, api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";

/*
 * Re-exported, not defined here. This module imports the axios client and
 * therefore React Native, which makes it unloadable from a node-side Vitest file —
 * and the reaction list is exactly the sort of thing a test wants to assert
 * against. Same split as `resident-api.ts` and `lib/food-week.ts`.
 */
import type { ReactionType } from "@/lib/community-enums";

export { REACTION_TYPES, type ReactionType } from "@/lib/community-enums";

export type CommunityMedia = {
  assetId: string;
  kind: "IMAGE" | "VIDEO";
};

export type CommunityPost = {
  authorImage: string | null;
  /** "Former member" once the account is purged — the post survives the name. */
  authorName: string;
  body: string;
  commentCount: number;
  createdAt?: string;
  hostelId: string | null;
  hostelName: string | null;
  id: string;
  isAnnouncement: boolean;
  isMine: boolean;
  media: CommunityMedia[];
  /** Total across **all** reaction types, not per type. */
  reactionCount: number;
  spaceType: "HOSTEL" | "PUBLIC";
  status: string;
  /** The viewer's own reaction, or null. One per user per post. */
  viewerReaction: ReactionType | null;
  visibility: "HOSTEL_ONLY" | "PUBLIC";
};

export type CommunityComment = {
  authorImage: string | null;
  authorName: string;
  body: string;
  createdAt?: string;
  /** Added by `listPostComments`, capped at 5 for display. Indent depth. */
  depth: number;
  id: string;
  isMine: boolean;
  parentId: string | null;
  score: number;
  /** `1`, `-1` or `0`. */
  viewerVote: number;
};

export type CommunitySpace = {
  id: string;
  isMine: boolean;
  name: string;
  postCount: number;
};

export type CommunitySpaces = {
  spaces: CommunitySpace[];
  viewer: {
    /** The server's answer to "may I write" — ask this, don't infer it. */
    canPost: boolean;
    hostelId: string | null;
    hostelName: string | null;
    /** Where *this* viewer's post would land. `HOSTEL` unlocks members-only. */
    spaceType: "HOSTEL" | "PUBLIC" | null;
  };
};

export type CommunityPagination = {
  hasMore: boolean;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type CommunityFeed = {
  pagination: CommunityPagination;
  posts: CommunityPost[];
};

/** `space` is `"all"`, `"public"`, `"mine"`, or a hostel id. */
export type CommunitySpaceId = string;

export async function getCommunitySpaces() {
  const response = await api.get<ApiEnvelope<CommunitySpaces>>("/community/spaces");

  return unwrap(response);
}

export async function getCommunityFeed(params: {
  page?: number;
  q?: string;
  sort?: "new" | "top";
  space?: CommunitySpaceId;
}) {
  const response = await api.get<ApiEnvelope<CommunityFeed>>("/community", { params });

  return unwrap(response);
}

export async function getCommunityPost(postId: string) {
  const response = await api.get<ApiEnvelope<{ post: CommunityPost }>>(
    `/community/${postId}`,
  );

  return unwrap(response).post;
}

export async function createCommunityPost(input: {
  body: string;
  media?: CommunityMedia[];
  visibility?: "HOSTEL_ONLY" | "PUBLIC";
}) {
  const response = await api.post<ApiEnvelope<{ post: CommunityPost }>>(
    "/community",
    input,
  );

  return unwrap(response).post;
}

export async function deleteCommunityPost(postId: string) {
  await api.delete<ApiEnvelope<unknown>>(`/community/${postId}`);
}

/**
 * The whole tree, already flattened into display order with a `depth` on each
 * row — `listPostComments` walks it server-side. Do **not** rebuild the tree:
 * paginating or re-sorting it would cut replies away from what they answer.
 */
export async function getPostComments(postId: string) {
  const response = await api.get<
    ApiEnvelope<{ comments: CommunityComment[]; pagination: CommunityPagination }>
  >(`/community/${postId}/comments`);

  return unwrap(response).comments;
}

export async function addPostComment(
  postId: string,
  input: { body: string; parentId?: string },
) {
  const response = await api.post<ApiEnvelope<{ comment: CommunityComment }>>(
    `/community/${postId}/comments`,
    input,
  );

  return unwrap(response).comment;
}

/**
 * One reaction per user per post, and it **toggles**: sending the type you
 * already have removes it and answers `{ reaction: null }`; sending a different
 * one replaces it.
 */
export async function reactToPost(postId: string, type: ReactionType) {
  const response = await api.post<ApiEnvelope<{ reaction: { type: string } | null }>>(
    `/community/${postId}/reactions`,
    { type },
  );

  return unwrap(response).reaction;
}

/** `0` clears the caller's vote; `1`/`-1` set it. */
export async function voteOnComment(
  postId: string,
  commentId: string,
  value: -1 | 0 | 1,
) {
  await api.post<ApiEnvelope<unknown>>(
    `/community/${postId}/comments/${commentId}/vote`,
    { value },
  );
}

/** `reason` is 3–500 characters. */
export async function reportPost(postId: string, reason: string) {
  await api.post<ApiEnvelope<unknown>>(`/community/${postId}/report`, { reason });
}

/**
 * A community asset's URL.
 *
 * No `Authorization` header, unlike `privateAssetSource`: these are `PUBLIC`
 * assets, so `files/[assetId]/url` 302s straight to the R2 public URL without
 * loading a principal — which is also why a signed-out reader can see them at all.
 */
export function communityMediaUrl(assetId: string, variant = "ORIGINAL") {
  return `${API_BASE_URL}/api/v1/files/${assetId}/url?variant=${variant}`;
}
