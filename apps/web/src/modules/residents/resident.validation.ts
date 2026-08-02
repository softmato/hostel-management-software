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

export const residentCreateSchema = z.object({
  ...optionalHostelScopeSchema,
  depositAmount: z.coerce.number().nonnegative().default(0),
  email: z.string().trim().email().optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  monthlyFee: z.coerce.number().nonnegative().default(0),
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
