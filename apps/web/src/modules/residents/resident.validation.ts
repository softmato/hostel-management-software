import { z } from "zod";

import { paginationQuerySchema } from "@/lib/pagination";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

const optionalHostelScopeSchema = {
  hostelId: objectIdSchema.optional(),
};

export const residentStatusSchema = z.object({
  ...optionalHostelScopeSchema,
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "MOVED_OUT"]),
});

export const residentTypeSchema = z.enum(["STUDENT", "WORKING_PROFESSIONAL", "OTHER"]);

export const residentListQuerySchema = z.object({
  ...optionalHostelScopeSchema,
  ...paginationQuerySchema,
  q: z.string().trim().min(1).max(120).optional(),
  residentType: residentTypeSchema.optional(),
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "MOVED_OUT"]).optional(),
});

/**
 * Registering somebody does **not** set their rent.
 *
 * `monthlyFee` used to be here with `.default(0)`, and that default was a
 * standing bug rather than a convenience: `Resident.monthlyFee` is an
 * *override*, `resolveMonthlyCharge` reads zero as a deliberate free stay, and
 * a form that submits nothing therefore registered every resident on a
 * permanent rent of nothing — the exact failure the model documents at §5.1 A2.
 *
 * So the field is gone from intake. Rent comes from the rate card, and an
 * override is a separate, deliberate act on the resident's own screen where a
 * reason is recorded alongside it. An unexplained number cannot become the norm
 * again if there is nowhere at the door to type one.
 */
export const residentCreateSchema = z.object({
  ...optionalHostelScopeSchema,
  /**
   * What was actually taken at the door. Omitted means "whatever the rate card
   * says" — the service fills it from the schedule rather than banking zero.
   */
  depositAmount: z.coerce.number().nonnegative().optional(),
  email: z.string().trim().email().optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  moveInDate: z.coerce.date(),
  phone: z.string().trim().min(7).max(24),
  /** Optional code of the resident who referred this one (PHASES.md §5.1). */
  referralCode: z.string().trim().min(4).max(32).optional(),
  residentType: residentTypeSchema.default("STUDENT"),
  roomType: z.string().trim().min(1).max(80),
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "MOVED_OUT"]).default("PENDING"),
});

export const residentUpdateSchema = z.object({
  ...optionalHostelScopeSchema,
  depositAmount: z.coerce.number().nonnegative().optional(),
  email: z.string().trim().email().optional(),
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  monthlyFee: z.coerce.number().nonnegative().optional(),
  moveInDate: z.coerce.date().optional(),
  phone: z.string().trim().min(7).max(24).optional(),
  residentType: residentTypeSchema.optional(),
  roomType: z.string().trim().min(1).max(80).optional(),
});

export const guardianCreateSchema = z.object({
  email: z.string().trim().email().optional(),
  firstName: z.string().trim().min(1).max(80),
  isPrimary: z.boolean().default(false),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(7).max(24),
  relation: z.string().trim().min(2).max(80),
});

export const emergencyContactCreateSchema = z.object({
  isPrimary: z.boolean().default(false),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(24),
  relation: z.string().trim().min(2).max(80),
});
