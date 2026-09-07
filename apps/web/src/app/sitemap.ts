import type { MetadataRoute } from "next";

import { listingTiers } from "@/app/_components/plans-catalog";
import { siteUrl } from "@/lib/site";
import { loadSiteConfig } from "@/lib/site-config-server";
import { listPublishedHostelSlugs } from "@/modules/hostels/hostel.service";

export const runtime = "nodejs";
// Regenerate at most hourly so newly-approved hostels appear without a redeploy.
export const revalidate = 3600;

const STATIC_ROUTES: {
  path: string;
  priority: number;
  changeFrequency: "daily" | "weekly" | "monthly";
}[] = [
  { path: "", priority: 1, changeFrequency: "daily" },
  { path: "/hostels", priority: 0.9, changeFrequency: "daily" },
  { path: "/compare", priority: 0.6, changeFrequency: "weekly" },
  { path: "/register-hostel", priority: 0.7, changeFrequency: "monthly" },
  { path: "/service-providers", priority: 0.6, changeFrequency: "weekly" },
  { path: "/about", priority: 0.4, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.4, changeFrequency: "monthly" },
  { path: "/plans-pricing", priority: 0.7, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "monthly" },
  { path: "/terms", priority: 0.3, changeFrequency: "monthly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: `${base}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  /*
   * Every service in the plans catalogue is its own indexable page, and so is
   * each directory badge — but the catalogue is owner-editable now, so the list
   * is read at generation time rather than imported as a constant. A service
   * the owner adds is in the sitemap on the next revalidation; one they remove
   * leaves it the same way. `loadSiteConfig` never throws, so an unreachable
   * database costs the sitemap these rows rather than the whole file.
   */
  const { plans: catalog } = await loadSiteConfig();

  const planEntries: MetadataRoute.Sitemap = [
    ...catalog.services.map((service) => ({
      url: `${base}/plans-pricing/${service.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
    ...listingTiers(catalog).map(({ tier }) => ({
      url: `${base}/plans-pricing/badge/${tier.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
  ];

  let hostelEntries: MetadataRoute.Sitemap = [];

  try {
    const hostels = await listPublishedHostelSlugs();
    hostelEntries = hostels.map((hostel) => ({
      url: `${base}/hostels/${hostel.slug}`,
      lastModified: hostel.updatedAt ?? now,
      changeFrequency: "daily",
      priority: 0.8,
    }));
  } catch {
    // If the DB is unreachable at generation time, still serve static routes.
    hostelEntries = [];
  }

  return [...staticEntries, ...planEntries, ...hostelEntries];
}
