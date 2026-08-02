import { z } from "zod";

import { paginationQuerySchema } from "@/lib/pagination";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

const optionalHostelScopeSchema = {
  hostelId: objectIdSchema.optional(),
};

export const referredInquiryCreateSchema = z.object({
  email: z.string().trim().email().optional(),
  message: z.string().trim().max(1200).optional(),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(24),
  referralCode: z.string().trim().min(4).max(32),
});

export const hostelAdminReferralListQuerySchema = z.object({
  ...paginationQuerySchema,
  ...optionalHostelScopeSchema,
  status: z.enum(["INQUIRY_CREATED", "JOINED", "REWARDED", "CANCELLED"]).optional(),
});

export const referralRewardUpdateSchema = z.object({
  ...optionalHostelScopeSchema,
  amount: z.coerce.number().nonnegative().optional(),
  notes: z.string().trim().max(500).optional(),
  rewardType: z.enum(["DISCOUNT", "CASH", "SERVICE_CREDIT", "OTHER"]).optional(),
  status: z.enum(["PENDING", "APPROVED", "PAID", "CANCELLED"]),
});

export const referralConfirmSchema = z.object({
  ...optionalHostelScopeSchema,
  joinedResidentId: objectIdSchema.optional(),
  rewardAmount: z.coerce.number().nonnegative().default(0),
  rewardNotes: z.string().trim().max(500).optional(),
  rewardType: z.enum(["DISCOUNT", "CASH", "SERVICE_CREDIT", "OTHER"]).default("DISCOUNT"),
});
