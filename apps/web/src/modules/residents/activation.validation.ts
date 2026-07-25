import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

export const activationCodeGenerateSchema = z.object({
  /** Omitted → falls back to PlatformSetting `operations.qrActivationExpiryDays`. */
  expiresInHours: z.coerce.number().int().min(1).max(1440).optional(),
  hostelId: objectIdSchema.optional(),
  /** Set false to issue a code without emailing the resident. */
  sendEmail: z.coerce.boolean().default(true),
});

export const activationCodeSchema = z.object({
  code: z.string().trim().min(6).max(32),
  deviceInfo: z.record(z.string(), z.unknown()).default({}),
  sessionInfo: z.record(z.string(), z.unknown()).default({}),
});

export const activationStatusQuerySchema = z.object({
  code: z.string().trim().min(6).max(32).optional(),
});
