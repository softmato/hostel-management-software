import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

export const complaintCategorySchema = z.enum([
  "FOOD",
  "ROOM",
  "MAINTENANCE",
  "SAFETY",
  "PAYMENT",
  "STAFF",
  "NOISE",
  "OTHER",
]);

export const complaintStatusSchema = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "RESOLVED",
  "REJECTED",
]);

export const complaintCreateSchema = z.object({
  attachmentAssetIds: z.array(z.string().trim().min(1)).max(5).default([]),
  category: complaintCategorySchema.default("OTHER"),
  description: z.string().trim().min(5).max(4000),
  isAnonymous: z.boolean().default(false),
  title: z.string().trim().min(2).max(160),
});

export const complaintListQuerySchema = z.object({
  category: complaintCategorySchema.optional(),
  hostelId: objectIdSchema.optional(),
  /** "overdue" = still open and past slaDueAt; "on_track" = the rest. */
  sla: z.enum(["overdue", "on_track"]).optional(),
  status: complaintStatusSchema.optional(),
});

export const complaintStatusUpdateSchema = z.object({
  hostelId: objectIdSchema.optional(),
  response: z.string().trim().min(2).max(2000).optional(),
  status: complaintStatusSchema,
});

export const complaintReplySchema = z.object({
  hostelId: objectIdSchema.optional(),
  message: z.string().trim().min(2).max(2000),
});

export const complaintResolutionConfirmSchema = z.object({
  note: z.string().trim().min(2).max(1000).optional(),
});
