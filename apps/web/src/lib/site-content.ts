import {
  AlertTriangle,
  Ban,
  BadgeCheck,
  Bed,
  Bell,
  Building2,
  CreditCard,
  Database,
  Eye,
  FileText,
  Globe,
  Heart,
  Home,
  LayoutDashboard,
  Lock,
  Mail,
  MapPin,
  QrCode,
  Receipt,
  Scale,
  Shield,
  ShieldCheck,
  Sparkles,
  Target,
  UserCheck,
  UserPlus,
  Users,
  Utensils,
  WalletCards,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { PublicSiteConfig } from "@/modules/platform-config/site-config.service";
import type { ContentPage } from "@/modules/platform-config/site-config.validation";

/**
 * Reading page copy that lives in the site config rather than in a component.
 *
 * Two things have to happen between the database and the screen, and both of
 * them are here so the phone can mirror them exactly (`apps/mobile/src/lib/
 * site-content.ts` is the same two functions against Ionicons).
 */

type SiteIdentity = PublicSiteConfig["identity"];

/**
 * Stored copy cannot interpolate, so it carries `{siteName}` and
 * `{supportEmail}` and they are replaced here.
 *
 * `supportEmail` is optional in the config, and a sentence that renders
 * "Contact our Data Protection team at ." is worse than one that names no
 * address at all — so a blank falls back to a phrase rather than to nothing.
 */
export function fillPlaceholders(text: string, identity: SiteIdentity) {
  return text
    .replaceAll("{siteName}", identity.siteName)
    .replaceAll("{supportEmail}", identity.supportEmail || "our support team");
}

/** The same substitution across a whole page, so call sites read the plain text. */
export function resolveContentPage(page: ContentPage, identity: SiteIdentity) {
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
 * Slug → icon. An editor types a name into a text field, so an unknown slug is
 * an ordinary typo and has to degrade rather than throw; `Sparkles` is the
 * schema's own default and the neutral choice.
 */
const CONTENT_ICONS: Record<string, LucideIcon> = {
  "alert-triangle": AlertTriangle,
  "badge-check": BadgeCheck,
  ban: Ban,
  bed: Bed,
  bell: Bell,
  building: Building2,
  "credit-card": CreditCard,
  database: Database,
  eye: Eye,
  "file-text": FileText,
  globe: Globe,
  heart: Heart,
  home: Home,
  "layout-dashboard": LayoutDashboard,
  lock: Lock,
  mail: Mail,
  "map-pin": MapPin,
  "qr-code": QrCode,
  receipt: Receipt,
  scale: Scale,
  shield: Shield,
  "shield-check": ShieldCheck,
  sparkles: Sparkles,
  target: Target,
  "user-check": UserCheck,
  "user-plus": UserPlus,
  users: Users,
  utensils: Utensils,
  wallet: WalletCards,
  wrench: Wrench,
};

export function contentIcon(slug: string): LucideIcon {
  return CONTENT_ICONS[slug] ?? Sparkles;
}

/** Every slug the admin editor offers as a hint. Sorted for a stable list. */
export const CONTENT_ICON_SLUGS = Object.keys(CONTENT_ICONS).sort();
