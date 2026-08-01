import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

/**
 * What the mobile background service posts (PHASES.md §4.1). The coordinates
 * are accepted, used to compute a zone, and then discarded — they are never
 * written to any collection.
 */
export const locationPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Device-reported accuracy in metres, used only to reject junk fixes. */
  accuracyMeters: z.number().min(0).max(100_000).optional(),
  recordedAt: z.coerce.date().optional(),
});

export const attendanceListQuerySchema = z.object({
  from: z.coerce.date().optional(),
  hostelId: objectIdSchema.optional(),
  residentId: objectIdSchema.optional(),
  to: z.coerce.date().optional(),
  zone: z.enum(["INSIDE", "NEARBY", "OUTSIDE", "UNKNOWN"]).optional(),
});

export const attendanceOverrideSchema = z.object({
  day: z.coerce.date(),
  hostelId: objectIdSchema.optional(),
  /** Required: an override without a stated reason is not auditable. */
  reason: z.string().trim().min(3).max(500),
  zone: z.enum(["INSIDE", "NEARBY", "OUTSIDE", "UNKNOWN"]),
});

export const attendanceSettingsSchema = z.object({
  absenceAlertDays: z.number().int().min(1).max(90).optional(),
  enabled: z.boolean().optional(),
  hostelId: objectIdSchema.optional(),
  insideZoneRadiusMeters: z.number().int().min(10).max(500).optional(),
  nearbyZoneRadiusMeters: z.number().int().min(20).max(2000).optional(),
  pingTimes: z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm."))
    .max(6)
    .optional(),
  retentionDays: z.number().int().min(30).max(1095).optional(),
});

export const consentSchema = z.object({
  consentType: z
    .enum(["LOCATION_TRACKING", "TERMS_OF_USE", "PRIVACY_POLICY"])
    .default("LOCATION_TRACKING"),
  granted: z.boolean(),
  policyVersion: z.string().trim().max(40).optional(),
  source: z.enum(["WEB", "MOBILE"]).default("WEB"),
});

export const attendanceAlertResolveSchema = z.object({
  hostelId: objectIdSchema.optional(),
  note: z.string().trim().max(1000).optional(),
});
