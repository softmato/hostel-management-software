import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

export const noticeListQuerySchema = z.object({
  category: z
    .enum(["GENERAL", "URGENT", "EVENT", "RULE", "MAINTENANCE", "PAYMENT", "FOOD"])
    .optional(),
  hostelId: objectIdSchema.optional(),
});

export const noticeCreateSchema = z.object({
  hostelId: objectIdSchema.optional(),
  title: z.string().trim().min(2).max(160),
  content: z.string().trim().min(2).max(4000),
  category: z
    .enum(["GENERAL", "URGENT", "EVENT", "RULE", "MAINTENANCE", "PAYMENT", "FOOD"])
    .default("GENERAL"),
  isUrgent: z.boolean().default(false),
  targetAudience: z.enum(["ALL", "RESIDENTS", "GUARDIANS"]).default("ALL"),
  publishedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
});

export const noticeUpdateSchema = noticeCreateSchema.partial().extend({
  hostelId: objectIdSchema.optional(),
});
