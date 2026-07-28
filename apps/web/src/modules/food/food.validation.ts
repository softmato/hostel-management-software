import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

export const mealTypeSchema = z.enum(["BREAKFAST", "LUNCH", "SNACKS", "DINNER"]);

export const foodMenuListQuerySchema = z.object({
  date: z.coerce.date().optional(),
  /** Inclusive range bounds, for callers that read a week or a month at a time. */
  from: z.coerce.date().optional(),
  hostelId: objectIdSchema.optional(),
  mealType: mealTypeSchema.optional(),
  to: z.coerce.date().optional(),
  weekStartDate: z.coerce.date().optional(),
});

export const foodMenuCreateSchema = z.object({
  hostelId: objectIdSchema.optional(),
  date: z.coerce.date(),
  weekStartDate: z.coerce.date(),
  dayOfWeek: z.enum([
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ]),
  mealType: mealTypeSchema,
  items: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  timing: z.string().trim().min(2).max(80),
  specialNotes: z.string().trim().max(500).optional(),
});

export const foodMenuUpdateSchema = foodMenuCreateSchema.partial().extend({
  hostelId: objectIdSchema.optional(),
});

export const foodPhotoUploadSchema = z.object({
  hostelId: objectIdSchema.optional(),
  mealType: mealTypeSchema,
  date: z.coerce.date(),
  photoAssetId: z.string().trim().min(1).max(240),
  caption: z.string().trim().max(240).optional(),
});

export const foodFeedbackSchema = z.object({
  menuId: objectIdSchema.optional(),
  date: z.coerce.date(),
  mealType: mealTypeSchema,
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
  isAnonymous: z.boolean().default(false),
});
