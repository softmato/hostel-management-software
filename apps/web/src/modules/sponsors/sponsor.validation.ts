import { z } from "zod";

import { paginationQuerySchema } from "@/lib/pagination";

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/i, "Use a 6-digit hex colour, e.g. #0a8a4b.");

/** Same-origin paths and absolute http(s) links; nothing else is navigable. */
const linkUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => value === "" || value.startsWith("/") || /^https?:\/\//i.test(value),
    "Link must start with / or http(s)://",
  );

export const sponsorCreateSchema = z.object({
  accentColor: hexColor.default("#0a8a4b"),
  ctaLabel: z.string().trim().max(40).default("View"),
  endsAt: z.coerce.date().optional(),
  highlight: z.string().trim().max(80).optional(),
  imageAssetId: z.string().trim().max(120).optional(),
  imageUrl: linkUrl.optional(),
  isActive: z.boolean().default(true),
  kind: z.enum(["COLLEGE", "HOSTEL", "BUSINESS", "OTHER"]).default("COLLEGE"),
  linkUrl: linkUrl.optional(),
  name: z.string().trim().min(1).max(120),
  /** Higher wins. Negative is allowed — it parks a sponsor below the default 0. */
  priority: z.coerce.number().int().min(-1000).max(1000).default(0),
  startsAt: z.coerce.date().optional(),
  subtitle: z.string().trim().max(160).optional(),
});

/** Every field optional, but an empty body is a mistake rather than a no-op. */
export const sponsorUpdateSchema = sponsorCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

export const sponsorListQuerySchema = z.object({
  ...paginationQuerySchema,
  status: z.enum(["active", "inactive", "all"]).default("all"),
});
