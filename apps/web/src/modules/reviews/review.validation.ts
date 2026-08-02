import { z } from "zod";

import { paginationQuerySchema } from "@/lib/pagination";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

const starRating = z.number().int().min(1).max(5);

/** Category keys shared by the create schema, the serializer and the averages. */
export const REVIEW_CATEGORY_KEYS = [
  "overallRating",
  "foodRating",
  "cleanlinessRating",
  "safetyRating",
  "roomRating",
  "locationRating",
  "managementRating",
] as const;

export type ReviewCategoryKey = (typeof REVIEW_CATEGORY_KEYS)[number];

export const reviewCreateSchema = z.object({
  cleanlinessRating: starRating.optional(),
  comment: z.string().trim().max(3000).optional(),
  foodRating: starRating.optional(),
  locationRating: starRating.optional(),
  managementRating: starRating.optional(),
  overallRating: starRating,
  roomRating: starRating.optional(),
  safetyRating: starRating.optional(),
});

export const reviewModerationSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export const platformReviewListQuerySchema = z.object({
  ...paginationQuerySchema,
  hostelId: objectIdSchema.optional(),
  status: z.enum(["VISIBLE", "HIDDEN"]).optional(),
});
