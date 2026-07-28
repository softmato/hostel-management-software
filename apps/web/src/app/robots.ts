import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep authenticated portals and API routes out of search indexes.
        disallow: [
          "/platform",
          "/hostel-admin",
          // Tenant workspaces live at /{hostel-slug}/admin/...
          "/*/admin",
          "/resident",
          "/guardian",
          "/api/",
        ],
      },
    ],
    host: base,
    sitemap: `${base}/sitemap.xml`,
  };
}
