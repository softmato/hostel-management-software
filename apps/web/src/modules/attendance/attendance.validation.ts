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
  /**
   * The nightly "are you in tonight?" prompt.
   *
   * Partial on purpose, and merged field-by-field by `updateAttendanceSettings`
   * rather than replaced: the app's editor sends only the hour and the web's
   * only the switch, and a shallow overwrite would have each of them silently
   * reset the other's field back to the default. That is exactly the "edit one
   * place, it changes everywhere" behaviour this feature was asked for, and the
   * way to get it wrong is to spread this object over the stored one.
   *
   * `promptTime` is bounded 17:00-23:45 here as well as in `parsePromptTime`,
   * so a warden gets a 422 telling them why rather than a saved value that the
   * cron then silently skips. The reason for those particular bounds lives in
   * `night-window.ts`, beside the night boundary they come from.
   */
  nightStatus: z
    .object({
      promptEnabled: z.boolean().optional(),
      promptTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm.")
        .refine(
          (value) => {
            const [hours, minutes] = value.split(":").map(Number);
            const minute = hours * 60 + minutes;

            return minute >= 17 * 60 && minute <= 23 * 60 + 45;
          },
          { message: "The check-in time must be between 17:00 and 23:45." },
        )
        .optional(),
      remindAfterMinutes: z.number().int().min(0).max(180).optional(),
    })
    .optional(),
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
