import { z } from "zod";

const imageUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => value === "" || value.startsWith("/") || /^https?:\/\//i.test(value),
    "Image must start with / or http(s)://",
  );

/**
 * No `.default()` here: Zod 4 applies defaults inside `.partial()`, so a PATCH
 * that only flips `isActive` would reset every other field. Defaults live on
 * the create schema alone.
 */
const perkFields = z.object({
  description: z.string().trim().max(300),
  giftValue: z.coerce.number().int().min(0).max(1_000_000).nullable(),
  imageUrl,
  isActive: z.boolean(),
  kind: z.enum(["FEE_OFF", "GIFT"]),
  partner: z.string().trim().max(80),
  percentOff: z.coerce.number().int().min(1).max(100).nullable(),
  sortOrder: z.coerce.number().int().min(-1000).max(1000),
  title: z.string().trim().min(1).max(80),
});

/** A fee-off perk must say how much comes off; a gift must not pretend to. */
export const perkCreateSchema = perkFields
  .extend({
    description: perkFields.shape.description.default(""),
    giftValue: perkFields.shape.giftValue.optional(),
    imageUrl: imageUrl.default(""),
    isActive: z.boolean().default(true),
    partner: perkFields.shape.partner.default(""),
    percentOff: perkFields.shape.percentOff.optional(),
    sortOrder: perkFields.shape.sortOrder.default(0),
  })
  .refine((perk) => perk.kind !== "FEE_OFF" || Boolean(perk.percentOff), {
    message: "A fee-off perk needs a percent off, 1–100.",
    path: ["percentOff"],
  })
  .transform((perk) => (perk.kind === "GIFT" ? { ...perk, percentOff: null } : perk));

export const perkUpdateSchema = perkFields
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

export const awardCreateSchema = z.object({
  note: z.string().trim().max(300).optional(),
  perkId: z.string().trim().min(1),
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/, "Quarter looks like 2083-Q2."),
  residentId: z.string().trim().min(1),
});

export const awardUpdateSchema = z.object({
  action: z.enum(["cancel", "deliver", "hostel-paid"]),
});
