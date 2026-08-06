import { z } from "zod";

/**
 * Every editable slice of the public website. Each key is stored as its own
 * `PlatformSetting` document so a save only ever rewrites the section the admin
 * actually touched.
 */

const trimmed = z.string().trim();
const optionalUrl = trimmed.max(300).or(z.literal("")).default("");

export const identitySchema = z.object({
  address: trimmed.max(200).default(""),
  siteName: trimmed.min(1).max(60),
  supportEmail: trimmed.email().or(z.literal("")).default(""),
  supportPhone: trimmed.max(40).default(""),
  tagline: trimmed.max(160).default(""),
});

export const heroSchema = z.object({
  headline: trimmed.min(1).max(120),
  primaryCtaHref: trimmed.max(200).default("/hostels"),
  primaryCtaLabel: trimmed.max(40).default("Browse Hostels"),
  searchPlaceholder: trimmed.max(120).default("Search by city, area, or hostel name"),
  secondaryCtaHref: trimmed.max(200).default("/register-hostel"),
  secondaryCtaLabel: trimmed.max(40).default("List Your Hostel"),
  subheadline: trimmed.max(280).default(""),
});

export const statsSchema = z
  .array(
    z.object({
      label: trimmed.min(1).max(60),
      suffix: trimmed.max(10).default(""),
      value: trimmed.min(1).max(20),
    }),
  )
  .max(8);

export const trustPointsSchema = z
  .array(
    z.object({
      description: trimmed.max(240).default(""),
      icon: trimmed.max(40).default("shield"),
      title: trimmed.min(1).max(80),
    }),
  )
  .max(12);

export const locationsSchema = z
  .array(
    z.object({
      areas: z.array(trimmed.min(1).max(60)).max(60).default([]),
      city: trimmed.min(1).max(60),
      enabled: z.boolean().default(true),
    }),
  )
  .max(40);

export const facilitiesSchema = z
  .array(
    z.object({
      enabled: z.boolean().default(true),
      icon: trimmed.max(40).default("sparkles"),
      label: trimmed.min(1).max(60),
      slug: trimmed.min(1).max(60),
    }),
  )
  .max(60);

export const pricingSchema = z
  .array(
    z.object({
      ctaHref: trimmed.max(200).default("/register-hostel"),
      ctaLabel: trimmed.max(40).default("Get Started"),
      description: trimmed.max(200).default(""),
      /** Off plans stay saved but are dropped from every public projection. */
      enabled: z.boolean().default(true),
      features: z.array(trimmed.min(1).max(120)).max(20).default([]),
      highlighted: z.boolean().default(false),
      name: trimmed.min(1).max(60),
      period: trimmed.max(30).default("per month"),
      price: trimmed.min(1).max(30),
    }),
  )
  .max(8);

export const announcementSchema = z.object({
  enabled: z.boolean().default(false),
  link: optionalUrl,
  linkLabel: trimmed.max(40).default(""),
  message: trimmed.max(240).default(""),
  tone: z.enum(["info", "success", "warning"]).default("info"),
});

export const socialSchema = z.object({
  facebook: optionalUrl,
  instagram: optionalUrl,
  linkedin: optionalUrl,
  tiktok: optionalUrl,
  website: optionalUrl,
  youtube: optionalUrl,
});

export const legalSchema = z.object({
  privacy: z.object({
    body: trimmed.max(20000).default(""),
    updatedAt: trimmed.max(40).default(""),
  }),
  terms: z.object({
    body: trimmed.max(20000).default(""),
    updatedAt: trimmed.max(40).default(""),
  }),
});

export const featuresSchema = z.object({
  compare: z.boolean().default(true),
  inquiries: z.boolean().default(true),
  publicRegistration: z.boolean().default(true),
  reviews: z.boolean().default(true),
  serviceProviderSignup: z.boolean().default(true),
});

export const siteConfigSectionSchemas = {
  announcement: announcementSchema,
  facilities: facilitiesSchema,
  features: featuresSchema,
  hero: heroSchema,
  identity: identitySchema,
  legal: legalSchema,
  locations: locationsSchema,
  pricing: pricingSchema,
  social: socialSchema,
  stats: statsSchema,
  trustPoints: trustPointsSchema,
} as const;

export type SiteConfigSection = keyof typeof siteConfigSectionSchemas;

export const SITE_CONFIG_SECTIONS = Object.keys(
  siteConfigSectionSchemas,
) as SiteConfigSection[];

export function isSiteConfigSection(value: string): value is SiteConfigSection {
  return (SITE_CONFIG_SECTIONS as string[]).includes(value);
}

export type SiteConfig = {
  [Section in SiteConfigSection]: z.infer<(typeof siteConfigSectionSchemas)[Section]>;
};
