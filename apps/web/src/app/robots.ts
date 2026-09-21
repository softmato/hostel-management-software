import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          // A search engine renders a page the way a browser does, and its
          // renderer obeys robots.txt for every request the page makes. With all
          // of /api/ closed, /hostels reached Google with no hostels on it and
          // every hostel photo missing. These are the public reads those pages
          // make; the longer rule wins over `/api/` below. The JSON answers
          // `X-Robots-Tag: noindex` (next.config.ts), so it is never a result.
          "/api/v1/public/hostels",
          "/api/v1/files/",
        ],
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
          "/hostel-registration-track-sheet",
          "/pay/",
          "/api/",
        ],
      },
    ],
    host: base,
    sitemap: `${base}/sitemap.xml`,
  };
}
