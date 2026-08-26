import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

/**
 * What the caller wants the table as.
 *
 * CSV stays the default so every existing link and bookmark keeps working — the
 * export routes have been CSV-only since they were built, and a default of
 * `pdf` would silently change what an unchanged URL returns.
 */
export const reportExportFormatSchema = z.enum(["csv", "pdf"]).default("csv");

export const platformReportExportSchema = z.object({
  format: reportExportFormatSchema,
  report: z.enum(["hostels", "residents", "payments", "complaints"]),
});

export const hostelAdminReportExportSchema = z.object({
  format: reportExportFormatSchema,
  hostelId: objectIdSchema.optional(),
  report: z.enum(["residents", "payments", "complaints", "occupancy"]),
});

export const reportQuerySchema = z.object({
  hostelId: objectIdSchema.optional(),
  month: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});
