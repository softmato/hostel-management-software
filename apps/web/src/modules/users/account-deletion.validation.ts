import { z } from "zod";

import { paginationQuerySchema } from "@/lib/pagination";

export const accountDeletionRequestSchema = z.object({
  // Required by PRIVACY_POLICY.md §8.1. The minimum is there to stop a single
  // character satisfying a field the platform owner has to read and act on.
  reason: z.string().trim().min(10, "Tell us briefly why, in a sentence or two.").max(1000),
});

export const accountDeletionCancelSchema = z.object({
  token: z.string().min(1),
});

export const accountDeletionReviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(1000).optional(),
});

export const accountDeletionListQuerySchema = z.object({
  ...paginationQuerySchema,
  reviewStatus: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});
