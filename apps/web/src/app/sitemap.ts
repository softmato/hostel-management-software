import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";
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
  { path: "/pricing", priority: 0.5, changeFrequency: "monthly" },
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

  return [...staticEntries, ...hostelEntries];
}
