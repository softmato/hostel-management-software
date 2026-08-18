import { z } from "zod";

import { paginationQuerySchema } from "@/lib/pagination";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

export const serviceProviderCategorySchema = z.enum([
  "PLUMBER",
  "ELECTRICIAN",
  "DOCTOR_CLINIC",
  "INTERNET_TECHNICIAN",
  "CLEANER",
  "CARPENTER",
  "PAINTER",
  "WATER_SUPPLIER",
  "APPLIANCE_REPAIR",
  "ROOM_REPAIR",
  "OTHER",
]);

export const serviceProviderRegisterSchema = z
  .object({
    area: z.string().trim().min(2).max(120),
    availability: z.string().trim().max(240).optional(),
    /**
     * One or more trades — tradespeople commonly work across several. The first is
     * treated as the headline (`ServiceProvider.category`). `category` is still
     * accepted so a single-trade caller keeps working; see
     * {@link normalizeProviderCategories}.
     */
    categories: z.array(serviceProviderCategorySchema).min(1).max(11).optional(),
    category: serviceProviderCategorySchema.optional(),
    city: z.string().trim().min(2).max(120).default("Kathmandu"),
    description: z.string().trim().max(1200).optional(),
    documents: z
      .array(
        z.object({
          documentType: z.string().trim().min(2).max(80),
          fileAssetId: objectIdSchema.optional(),
          fileUrl: z.string().trim().url().optional(),
        }),
      )
      .max(8)
      .default([]),
    /**
     * Optional: many local tradespeople have no working mailbox, and the
     * directory is reachable by phone. Present so the §6 registration/approval/
     * rejection emails can be sent to those who do have one.
     */
    email: z.string().trim().email().optional(),
    experience: z.string().trim().max(240).optional(),
    fullName: z.string().trim().min(2).max(160),
    phone: z.string().trim().min(7).max(24),
    photoAssetId: objectIdSchema.optional(),
  })
  .refine((input) => Boolean(input.categories?.length || input.category), {
    message: "Select at least one trade.",
    path: ["categories"],
  });

/**
 * Collapses the two accepted shapes into the pair the record stores: the full
 * trade list, and the headline trade that legacy reads and email copy use.
 * De-duplicated because the form can submit the same trade twice on a fast
 * double-toggle.
 */
export function normalizeProviderCategories(input: {
  categories?: string[];
  category?: string;
}) {
  const categories = Array.from(
    new Set([...(input.categories ?? []), ...(input.category ? [input.category] : [])]),
  );

  return { categories, category: categories[0] as string };
}

export const platformServiceProviderListQuerySchema = z.object({
  ...paginationQuerySchema,
  area: z.string().trim().min(1).max(120).optional(),
  category: serviceProviderCategorySchema.optional(),
  status: z
    .enum(["PENDING_APPROVAL", "APPROVED", "REJECTED", "HIDDEN", "INACTIVE"])
    .optional(),
});

export const publicServiceProviderListQuerySchema = z.object({
  area: z.string().trim().min(1).max(120).optional(),
  category: serviceProviderCategorySchema.optional(),
  city: z.string().trim().min(1).max(120).optional(),
});

export const serviceProviderRejectSchema = z.object({
  reason: z.string().trim().min(2).max(800),
});

export const hostelAdminServiceProviderListQuerySchema = z.object({
  ...paginationQuerySchema,
  area: z.string().trim().min(1).max(120).optional(),
  category: serviceProviderCategorySchema.optional(),
  q: z.string().trim().min(1).max(160).optional(),
});

/**
 * What a service provider may set on their own assigned job.
 *
 * Two of the five statuses, and the narrowing is the point:
 * `maintenanceStatusUpdateSchema` is the hostel's schema and accepts
 * `CANCELLED`, `SCHEDULED` and `PENDING` as well. Reusing it here would let a
 * contractor cancel the hostel's work order, schedule themselves without a
 * date, or reopen a job they had already been signed off for.
 */
export const serviceProviderJobStatusSchema = z.object({
  note: z.string().trim().max(800).optional(),
  status: z.enum(["CONTACTED", "COMPLETED"]),
});
