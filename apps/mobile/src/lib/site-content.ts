import type { Ionicons } from "@expo/vector-icons";

import type { ContentPage, SiteIdentity } from "@/lib/site-config-api";

/**
 * Reading the page copy the superadmin authors, on the phone.
 *
 * This is the counterpart of `apps/web/src/lib/site-content.ts` — the same two
 * operations, against Ionicons instead of lucide. Both files exist because the
 * app does not link the web workspace (it has its own `node_modules` and its own
 * Metro resolver), so what is shared between the two clients is the *payload*,
 * not the module. The payload is the thing that has to agree; a second twenty-line
 * mapping table is not a second privacy policy.
 */

type IoniconName = keyof typeof Ionicons.glyphMap;

/**
 * Stored copy cannot interpolate, so it carries `{siteName}` and
 * `{supportEmail}` and they are replaced here.
 *
 * A blank support email falls back to a phrase rather than to nothing, so a
 * sentence never renders as "Contact our Data Protection team at ." — same rule
 * as the web, and it has to be the same rule, or the two clients print different
 * sentences from one stored string.
 */
export function fillPlaceholders(text: string, identity: SiteIdentity) {
  return text
    .replaceAll("{siteName}", identity.siteName)
    .replaceAll("{supportEmail}", identity.supportEmail || "our support team");
}

export type ResolvedContentPage = {
  highlights: { label: string; value: string }[];
  intro: string[];
  noteBody: string;
  noteTitle: string;
  sections: { body: string[]; icon: string; title: string }[];
  subtitle: string;
};

/** The same substitution across a whole page, so screens read plain text. */
export function resolveContentPage(
  page: ContentPage,
  identity: SiteIdentity,
): ResolvedContentPage {
  const fill = (text: string) => fillPlaceholders(text, identity);

  return {
    highlights: page.highlights,
    intro: page.intro.map(fill),
    noteBody: fill(page.noteBody),
    noteTitle: fill(page.noteTitle),
    sections: page.sections.map((section) => ({
      body: section.body.map(fill),
      icon: section.icon,
      title: fill(section.title),
    })),
    subtitle: fill(page.subtitle),
  };
}

/**
 * Slug → glyph. The slugs are the website's, so this table has to cover the
 * same set; an unknown one is an ordinary typo in a text field on the admin
 * page and degrades to the schema's own default rather than throwing.
 *
 * The outline variants are deliberate — every icon elsewhere in the app is an
 * outline glyph, and a filled mark in a document would read as an alert.
 */
const CONTENT_ICONS: Record<string, IoniconName> = {
  "alert-triangle": "warning-outline",
  "badge-check": "checkmark-circle-outline",
  ban: "ban-outline",
  bed: "bed-outline",
  bell: "notifications-outline",
  building: "business-outline",
  "credit-card": "card-outline",
  database: "server-outline",
  eye: "eye-outline",
  "file-text": "document-text-outline",
  globe: "globe-outline",
  heart: "heart-outline",
  home: "home-outline",
  "layout-dashboard": "grid-outline",
  lock: "lock-closed-outline",
  mail: "mail-outline",
  "map-pin": "location-outline",
  "qr-code": "qr-code-outline",
  receipt: "receipt-outline",
  scale: "scale-outline",
  shield: "shield-outline",
  "shield-check": "shield-checkmark-outline",
  sparkles: "sparkles-outline",
  target: "locate-outline",
  "user-check": "person-circle-outline",
  "user-plus": "person-add-outline",
  users: "people-outline",
  utensils: "restaurant-outline",
  wallet: "wallet-outline",
  wrench: "construct-outline",
};

export function contentIcon(slug: string): IoniconName {
  return CONTENT_ICONS[slug] ?? "sparkles-outline";
}
