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

export const communityPostCreateSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  isAnonymous: z.boolean().default(false),
  mediaAssetIds: z.array(z.string().trim().min(1)).max(6).default([]),
  visibility: z.enum(["PUBLIC", "HOSTEL_ONLY"]).default("HOSTEL_ONLY"),
});

export const communityFeedQuerySchema = z.object({
  ...paginationQuerySchema,
  hostelId: objectIdSchema.optional(),
  /** "mine" narrows the feed to the caller's own posts. */
  scope: z.enum(["hostel", "mine"]).default("hostel"),
});

export const communityCommentCreateSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  isAnonymous: z.boolean().default(false),
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
  status: z.enum(["VISIBLE", "HIDDEN"]).optional(),
});

export const communityHideSchema = z.object({
  hostelId: objectIdSchema.optional(),
  reason: z.string().trim().min(3).max(500),
});

export const communityAnnouncementSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  hostelId: objectIdSchema.optional(),
});
