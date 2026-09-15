import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time.");

const noticePushFields = {
  body: z.string().trim().min(2).max(500),
  /** LATER as a date and time. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.").optional(),
  /** LATER as "in N minutes"; wins over `date` + `time`. */
  delayMinutes: z.number().int().min(1).max(60 * 24 * 60).optional(),
  hostelId: objectIdSchema.optional(),
  isUrgent: z.boolean().optional(),
  repeat: z.enum(["NOW", "LATER", "DAILY", "WEEKLY"]),
  time: timeSchema.optional(),
  title: z.string().trim().min(2).max(120),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
};

export const noticePushListQuerySchema = z.object({ hostelId: objectIdSchema.optional() });

export const noticePushCreateSchema = z.object(noticePushFields);

export const noticePushUpdateSchema = z
  .object(noticePushFields)
  .partial()
  .extend({
    /** false pauses a repeat, true resumes it. */
    active: z.boolean().optional(),
  });

export const noticePushScopeSchema = z.object({ hostelId: objectIdSchema.optional() });
