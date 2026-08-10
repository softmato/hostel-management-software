import { z } from "zod";

import { BED_TYPES } from "@hostel/shared/types/bed-type";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

/**
 * Whole NPR rupees (ADR-1). `.int()` at the edge is the first of three gates —
 * the schema here, `assertWholeRupees` in the arithmetic, and a Mongoose
 * validator at storage — because a fraction that reaches the ledger voids the
 * exactness the whole design rests on.
 */
const wholeRupeeSchema = z
  .number()
  .int("Amount must be a whole number of rupees.")
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);

/** "YYYY-MM", the period key used across billing. */
export const periodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must be YYYY-MM.");

const rateSchema = z.object({
  bedType: z.enum(BED_TYPES),
  monthlyAmount: wholeRupeeSchema,
});

export const feeScheduleCreateSchema = z.object({
  admissionFee: wholeRupeeSchema.optional(),
  depositAmount: wholeRupeeSchema.optional(),
  effectiveFrom: z.coerce.date(),
  hostelId: objectIdSchema.optional(),
  // At least one rate: an empty rate card prices nobody, and would fail every
  // resident with BED_TYPE_NOT_PRICED at the next billing run.
  rates: z
    .array(rateSchema)
    .min(1, "A schedule needs at least one rate.")
    .max(BED_TYPES.length)
    .refine(
      (rates) => new Set(rates.map((rate) => rate.bedType)).size === rates.length,
      "Each bed type may appear once.",
    ),
});

export const feeScheduleCloseSchema = z.object({
  effectiveTo: z.coerce.date(),
  hostelId: objectIdSchema.optional(),
});

export const feeScheduleListQuerySchema = z.object({
  hostelId: objectIdSchema.optional(),
});

export type FeeScheduleCreateInput = z.infer<typeof feeScheduleCreateSchema>;
export type FeeScheduleCloseInput = z.infer<typeof feeScheduleCloseSchema>;
