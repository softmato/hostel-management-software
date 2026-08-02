import { z } from "zod";

import { paginationQuerySchema } from "@/lib/pagination";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM format.");

export const paymentListQuerySchema = z.object({
  ...paginationQuerySchema,
  hostelId: objectIdSchema.optional(),
  month: monthSchema.optional(),
  residentId: objectIdSchema.optional(),
  status: z.enum(["UNPAID", "PAID", "PARTIAL", "OVERDUE", "PENDING_PROOF"]).optional(),
});

export const paymentCreateSchema = z.object({
  hostelId: objectIdSchema.optional(),
  residentId: objectIdSchema,
  month: monthSchema,
  dueAmount: z.coerce.number().nonnegative(),
  paidAmount: z.coerce.number().nonnegative().default(0),
  dueDate: z.coerce.date(),
  paidDate: z.coerce.date().optional(),
  status: z
    .enum(["UNPAID", "PAID", "PARTIAL", "OVERDUE", "PENDING_PROOF"])
    .default("UNPAID"),
  paymentMethod: z
    .enum(["CASH", "ESEWA", "KHALTI", "FONEPAY", "BANK_TRANSFER", "OTHER"])
    .optional(),
  remarks: z.string().trim().max(500).optional(),
});

export const paymentUpdateSchema = paymentCreateSchema
  .omit({ residentId: true })
  .partial()
  .extend({
    hostelId: objectIdSchema.optional(),
  });

export const paymentProofSubmitSchema = z.object({
  amount: z.coerce.number().positive(),
  paymentMethod: z
    .enum(["CASH", "ESEWA", "KHALTI", "FONEPAY", "BANK_TRANSFER", "OTHER"])
    .default("OTHER"),
  proofImageAssetId: z.string().trim().min(1).max(240),
  referenceNote: z.string().trim().max(240).optional(),
  transactionCode: z.string().trim().max(120).optional(),
});

/**
 * Bulk fee run: creates the month's payment record for every active resident
 * that does not already have one (PHASES.md §3.1 "Fee Management").
 */
export const monthlyPaymentGenerateSchema = z.object({
  /** Applied to residents with no `monthlyFee` of their own. */
  defaultAmount: z.coerce.number().nonnegative().optional(),
  dueDate: z.coerce.date(),
  hostelId: objectIdSchema.optional(),
  month: monthSchema,
  residentIds: z.array(objectIdSchema).optional(),
});

export const residentFeeUpdateSchema = z.object({
  hostelId: objectIdSchema.optional(),
  monthlyFee: z.coerce.number().nonnegative(),
  /** Omitted → applies to every active resident in scope. */
  residentIds: z.array(objectIdSchema).optional(),
});

/**
 * Month matrix: who has paid / part-paid / not paid for a month. Rows for the
 * requested month are auto-generated (with move-in proration), so admins never
 * have to run a manual fee run for the normal flow.
 */
export const paymentMatrixQuerySchema = z.object({
  hostelId: objectIdSchema.optional(),
  month: monthSchema.optional(),
});

export const paymentProofReviewSchema = z.object({
  hostelId: objectIdSchema.optional(),
  rejectionReason: z.string().trim().min(3).max(500).optional(),
});
