import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

const optionalHostelScopeSchema = {
  hostelId: objectIdSchema.optional(),
};

export const maintenanceCategorySchema = z.enum([
  "PLUMBING",
  "ELECTRICAL",
  "INTERNET",
  "CLEANING",
  "CARPENTRY",
  "PAINTING",
  "WATER",
  "APPLIANCE",
  "ROOM_REPAIR",
  "HEALTH",
  "OTHER",
]);

export const maintenanceStatusSchema = z.enum([
  "PENDING",
  "CONTACTED",
  "SCHEDULED",
  "COMPLETED",
  "CANCELLED",
]);

export const maintenanceRequestCreateSchema = z.object({
  ...optionalHostelScopeSchema,
  category: maintenanceCategorySchema,
  costNote: z.string().trim().max(500).optional(),
  description: z.string().trim().max(1600).optional(),
  /** Free text — "Room 204", "2nd floor bathroom". No room records exist. */
  location: z.string().trim().max(160).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  providerId: objectIdSchema.optional(),
  remarks: z.string().trim().max(800).optional(),
  scheduledFor: z.coerce.date().optional(),
  title: z.string().trim().min(2).max(180),
});

export const maintenanceRequestListQuerySchema = z.object({
  ...optionalHostelScopeSchema,
  category: maintenanceCategorySchema.optional(),
  providerId: objectIdSchema.optional(),
  status: maintenanceStatusSchema.optional(),
});

export const maintenanceStatusUpdateSchema = z.object({
  ...optionalHostelScopeSchema,
  costNote: z.string().trim().max(500).optional(),
  note: z.string().trim().max(800).optional(),
  scheduledFor: z.coerce.date().optional(),
  status: maintenanceStatusSchema,
});

export const maintenanceCommentCreateSchema = z.object({
  ...optionalHostelScopeSchema,
  message: z.string().trim().min(1).max(1000),
  visibility: z.enum(["INTERNAL", "PROVIDER_NOTE"]).default("INTERNAL"),
});
