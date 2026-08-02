import { z } from "zod";

import { paginationQuerySchema } from "@/lib/pagination";

export const listingFlagListQuerySchema = z.object({
  ...paginationQuerySchema,
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  status: z.enum(["OPEN", "RESOLVED", "DISMISSED"]).optional(),
});

export const listingFlagResolveSchema = z.object({
  resolutionNote: z.string().trim().min(2).max(800),
  status: z.enum(["RESOLVED", "DISMISSED"]),
});
