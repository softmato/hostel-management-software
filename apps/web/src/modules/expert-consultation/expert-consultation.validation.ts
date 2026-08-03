import { z } from "zod";

export const expertConsultationCreateSchema = z.object({
  budgetRange: z.string().trim().max(80).optional(),
  email: z.string().trim().email().optional(),
  environment: z.string().trim().max(120).optional(),
  fullName: z.string().trim().min(2).max(120),
  likedSpots: z.string().trim().max(500).optional(),
  phone: z.string().trim().min(7).max(24),
  preferredCollege: z.string().trim().max(160).optional(),
});
