import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

export const cookPortalUpdateSchema = z.object({
  cookName: z.string().trim().min(2).max(80).optional(),
  enabled: z.boolean(),
  hostelId: objectIdSchema.optional(),
});

export const foodReadySchema = z.object({
  deviceInfo: z.record(z.string(), z.unknown()).default({}),
  hostelId: objectIdSchema.optional(),
  mealType: z.enum(["BREAKFAST", "LUNCH", "SNACKS", "DINNER"]),
  /** Custom announcement. Omitted → today's menu items, or a plain "ready" ping. */
  message: z.string().trim().max(240).optional(),
  /** When true, the message is built from today's menu for this meal. */
  useMenuDescription: z.boolean().default(true),
});
