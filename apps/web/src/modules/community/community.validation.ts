import { z } from "zod";

import { paginationQuerySchema } from "@/lib/pagination";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

export const REACTION_TYPES = [
  "LIKE",
  "LOVE",
  "LAUGH",
  "SAD",
  "ANGRY",
  "SUPPORT",
] as const;

const mediaSchema = z.object({
  assetId: z.string().trim().min(1),
  kind: z.enum(["IMAGE", "VIDEO"]),
});

export const communityPostCreateSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  /**
   * Only a hostel post has an audience choice to make; on a public-space post
   * the service forces PUBLIC because there is no narrower audience to fall
   * back to. Default PUBLIC — the community is a shared space first.
   */
  visibility: z.enum(["PUBLIC", "HOSTEL_ONLY"]).default("PUBLIC"),
  media: z.array(mediaSchema).max(6).default([]),
});

/**
 * `space` is either the literal "all"/"public" or a hostel id. The author never
 * picks a space when posting, but a reader picks one when browsing.
 */
export const communityFeedQuerySchema = z.object({
  ...paginationQuerySchema,
  /** Free-text search over post bodies. Also how a trending tag is applied. */
  q: z.string().trim().max(120).optional(),
  space: z
    .union([z.literal("all"), z.literal("public"), z.literal("mine"), objectIdSchema])
    .default("all"),
  sort: z.enum(["new", "top"]).default("new"),
});

export const communityCommentCreateSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  /** Set to reply to an existing comment; omitted for a top-level comment. */
  parentId: objectIdSchema.optional(),
});

/** `0` clears the caller's existing vote. */
export const communityVoteSchema = z.object({
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

export const communityReactionSchema = z.object({
  type: z.enum(REACTION_TYPES),
});

export const communityReportSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const communityModerationQuerySchema = z.object({
  ...paginationQuerySchema,
  hostelId: objectIdSchema.optional(),
  /** "flagged" is the queue itself; the others browse everything in scope. */
  filter: z.enum(["flagged", "hidden", "all"]).default("flagged"),
});

export const communityHideSchema = z.object({
  hostelId: objectIdSchema.optional(),
  reason: z.string().trim().min(3).max(500),
});

export const communityAnnouncementSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  hostelId: objectIdSchema.optional(),
});
