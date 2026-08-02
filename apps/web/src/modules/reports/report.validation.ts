import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

export const platformReportExportSchema = z.object({
  report: z.enum(["hostels", "residents", "payments", "complaints"]),
});

export const hostelAdminReportExportSchema = z.object({
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
