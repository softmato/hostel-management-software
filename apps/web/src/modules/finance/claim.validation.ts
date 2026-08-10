import { z } from "zod";

/**
 * Resident claim and owner review inputs (plan item 2.8, target §11.2–§11.4).
 *
 * Ports `payment.validation.ts`'s proof schemas onto the ledger's vocabulary.
 * The one addition is `amount` being an integer at the boundary: whole rupees
 * are the ledger's foundation (ADR-1), and rejecting a fractional claim here
 * beats rounding one silently three layers down.
 */

export const PAYMENT_METHODS = [
  "CASH",
  "ESEWA",
  "KHALTI",
  "FONEPAY",
  "BANK_TRANSFER",
  "OTHER",
] as const;

export const claimSubmitSchema = z.object({
  amount: z.number().int().positive(),
  paidAt: z.coerce.date().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  proofImageAssetId: z.string().trim().min(1),
  referenceNote: z.string().trim().max(500).optional(),
  transactionCode: z.string().trim().max(120).optional(),
});

/**
 * The reasons a claim may be rejected (target §11.4, plan item 3.5).
 *
 * A fixed list rather than the free-text `window.prompt()` this replaces
 * (current §5.2). Three things follow from fixing it: the resident gets a
 * sentence they can act on instead of "wrong", the reasons become countable —
 * which is what tells an owner their instructions are unclear rather than their
 * residents careless — and nobody types an accusation into a permanent record.
 *
 * `OTHER` exists because a fixed list that cannot express the real reason gets
 * worked around, so it carries a required note.
 */
export const CLAIM_REJECTION_REASONS = {
  AMOUNT_MISMATCH: "The amount does not match this invoice.",
  ALREADY_RECORDED: "This payment has already been recorded.",
  NOT_RECEIVED: "We have not received this payment yet.",
  UNREADABLE_PROOF: "The screenshot is unreadable — please send a clearer one.",
  WRONG_ACCOUNT: "The payment went to an account we do not use.",
  WRONG_INVOICE: "This payment belongs to a different month.",
  OTHER: "Other",
} as const;

export type ClaimRejectionReasonCode = keyof typeof CLAIM_REJECTION_REASONS;

export const claimRejectSchema = z.object({
  hostelId: z.string().optional(),
  /**
   * Required, and shown to the resident. A rejection they cannot act on sends
   * them straight to the hostel office to ask why.
   */
  rejectionReason: z.string().trim().min(3).max(500),
});

export const claimApproveSchema = z.object({
  hostelId: z.string().optional(),
});

export const reviewQueueQuerySchema = z.object({
  hostelId: z.string().optional(),
  status: z.enum(["PENDING", "SETTLED", "REJECTED"]).default("PENDING"),
});

export type ClaimSubmitInput = z.infer<typeof claimSubmitSchema>;
export type ClaimRejectInput = z.infer<typeof claimRejectSchema>;
export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>;
