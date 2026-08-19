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

/**
 * Who transactional email comes from (docs/EMAIL_SYSTEM.md §0).
 *
 * Every field is optional-with-a-blank-default on purpose: a blank falls back
 * to something sensible rather than sending mail from an empty address.
 * `senderName` falls back to the site name, `replyTo` to the support email,
 * and each mailbox to its shipped local-part. So the platform owner can leave
 * the whole section alone and still get correct, branded mail.
 *
 * `domain` is the one field with teeth. It must be a domain verified in Resend;
 * anything else is not a cosmetic mistake, it is every email bouncing. It is
 * editable here because a platform owner who moves off the shared Softmato
 * domain has nowhere else to say so, but the UI labels the risk.
 */
const mailbox = trimmed
  .max(40)
  .regex(
    /^$|^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i,
    "Use the part before the @ only — letters, digits, dot, dash, underscore.",
  )
  .default("");

export const emailSchema = z.object({
  alertMailbox: mailbox,
  billingMailbox: mailbox,
  domain: trimmed
    .max(120)
    .regex(
      /^$|^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i,
      "Enter a bare domain such as softmato.com — no @, protocol, or path.",
    )
    .default(""),
  infoMailbox: mailbox,
  noreplyMailbox: mailbox,
  replyTo: trimmed.email().or(z.literal("")).default(""),
  securityMailbox: mailbox,
  senderName: trimmed.max(60).default(""),
  supportMailbox: mailbox,
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

/**
 * ## Page copy, as configuration
 *
 * Everything below used to be hardcoded in the page components — the privacy
 * sections in `public-privacy-page.tsx`, the terms in `public-terms-page.tsx`,
 * the values in `public-about-page.tsx`, the FAQ in `public-contact-page.tsx`,
 * and so on. That was survivable while the website was the only client.
 *
 * It stopped being survivable when the mobile app grew the same pages. Two
 * hardcoded copies of a privacy policy is two privacy policies, and the one the
 * user read is whichever client they happened to open. The platform cannot
 * state its own terms two ways.
 *
 * So the copy moved here: authored in Platform → Website Config → Page Content,
 * served by `/public/site-config`, rendered by both clients. The shipped text is
 * the **default value** of this section, not a fallback buried in a component —
 * which is what makes the admin page open pre-filled with the real document
 * instead of an empty textarea, and what makes "reset" mean something.
 *
 * ### Icons are slugs, not components
 *
 * A stored icon is a name like `shield` or `receipt`. The website maps it to a
 * lucide component and the app maps it to an Ionicons glyph, each with a
 * fallback for a slug it does not know. Neither client can store a React
 * component in Mongo, and a slug an editor typed wrong must degrade to a
 * generic icon rather than to a crash.
 *
 * ### `{siteName}` and `{supportEmail}` are substituted at render time
 *
 * The old copy interpolated those with template literals. Stored text cannot,
 * so the two braces survive as placeholders and each client replaces them from
 * the `identity` section. An owner who renames the platform renames it
 * everywhere, including in sentences they never edited.
 */
const contentSectionSchema = z.object({
  /** One paragraph per entry, rendered as a bulleted list. */
  body: z.array(trimmed.min(1).max(800)).max(24).default([]),
  icon: trimmed.max(40).default("sparkles"),
  title: trimmed.min(1).max(120),
});

/** A `label`/`value` pair — the stat strips on the two partner landing pages. */
const contentHighlightSchema = z.object({
  label: trimmed.min(1).max(60),
  value: trimmed.min(1).max(30),
});

const contentPageSchema = z.object({
  /** Stat strip. Empty on the document pages, which have none. */
  highlights: z.array(contentHighlightSchema).max(8).default([]),
  /** The paragraphs between the title and the first section. */
  intro: z.array(trimmed.min(1).max(1200)).max(6).default([]),
  sections: z.array(contentSectionSchema).max(24).default([]),
  /** The one line under the page title. */
  subtitle: trimmed.max(200).default(""),
  /** The bordered aside each page closes on. Blank body hides it. */
  noteBody: trimmed.max(1200).default(""),
  noteTitle: trimmed.max(160).default(""),
});

export const contentSchema = z.object({
  about: contentPageSchema,
  /** Shared by the website's Contact page and the app's Contact screen. */
  faq: z
    .array(
      z.object({
        answer: trimmed.min(1).max(1200),
        question: trimmed.min(1).max(200),
      }),
    )
    .max(20)
    .default([]),
  offerProgram: contentPageSchema,
  privacy: contentPageSchema,
  registerHostel: contentPageSchema,
  serviceProviders: contentPageSchema,
  terms: contentPageSchema,
});

export type ContentPage = z.infer<typeof contentPageSchema>;
export type ContentSection = z.infer<typeof contentSectionSchema>;

/**
 * `body` here is the **free-text override**: plain text with `#` headings and
 * `-` bullets, which replaces the structured sections in `content` entirely.
 * It exists for an owner whose lawyer hands them a document rather than a list
 * of claims. `updatedAt` is shown under the title either way.
 */
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
  content: contentSchema,
  email: emailSchema,
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
