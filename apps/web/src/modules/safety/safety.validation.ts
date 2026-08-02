import { z } from "zod";

import { paginationQuerySchema } from "@/lib/pagination";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

export const nightStatusSchema = z.enum([
  "INSIDE_HOSTEL",
  "OUTSIDE_HOSTEL",
  "NOT_VERIFIED",
  "MARKED_SAFE",
  "SOS_TRIGGERED",
]);

export const nightStatusUpdateSchema = z.object({
  note: z.string().trim().max(1000).optional(),
  status: nightStatusSchema,
});

export const nightStatusListQuerySchema = z.object({
  ...paginationQuerySchema,
  hostelId: objectIdSchema.optional(),
  status: nightStatusSchema.optional(),
});

export const nightStatusOverrideSchema = z.object({
  hostelId: objectIdSchema.optional(),
  reason: z.string().trim().min(3).max(1000),
  status: nightStatusSchema,
});

export const sosCreateSchema = z.object({
  guardianAlertEnabled: z.boolean().default(false),
  message: z.string().trim().max(1000).optional(),
});

export const sosListQuerySchema = z.object({
  ...paginationQuerySchema,
  hostelId: objectIdSchema.optional(),
  status: z.enum(["ACTIVE", "ACKNOWLEDGED", "RESOLVED", "FALSE_ALARM"]).optional(),
});

export const sosStatusUpdateSchema = z.object({
  hostelId: objectIdSchema.optional(),
  note: z.string().trim().max(1000).optional(),
  status: z.enum(["ACKNOWLEDGED", "RESOLVED", "FALSE_ALARM"]),
});
