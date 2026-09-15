import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep authenticated portals, checkouts and API routes out of search
        // indexes. Pages that are public but personal (invites, resident IDs,
        // inquiry forms) stay crawlable and say `noindex` themselves, which is
        // the only way a search engine can see that instruction.
        //
        // Rules are prefix matches, so each portal is closed as `/x/` plus `/x$`:
        // a bare "/resident" also blocked the public /resident-offer-program.
        disallow: [
          "/platform/",
          "/platform$",
          "/hostel-admin/",
          "/hostel-admin$",
          // Tenant workspaces live at /{hostel-slug}/admin/...
          "/*/admin",
          "/resident/",
          "/resident$",
          "/guardian/",
          "/guardian$",
          "/team/",
          "/team$",
          "/pay/",
          "/api/",
        ],
      },
    ],
    host: base,
    sitemap: `${base}/sitemap.xml`,
  };
}
