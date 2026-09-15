import type { MetadataRoute } from "next";

import { PLATFORM_NAME } from "@hostel/shared/brand/brand";

import { loadSeo, resolveSeoPage } from "@/lib/seo-config";

/**
 * The web app manifest: the name, icons and colour a browser uses for the site.
 *
 * `display: "browser"` on purpose. HostelPalika has a dedicated app, and a
 * standalone manifest would have Chrome offer to install the website as a
 * second, lesser one. When the Play listing is live, add it under
 * `related_applications` with `prefer_related_applications: true` so Chrome
 * points people to the real app instead.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { fill, seo } = await loadSeo();
  const home = resolveSeoPage(seo, "home", fill);

  return {
    background_color: "#ffffff",
    categories: ["business", "education", "lifestyle"],
    description: home.description,
    display: "browser",
    icons: [
      { sizes: "512x512", src: "/icon.png", type: "image/png" },
      { sizes: "180x180", src: "/apple-icon.png", type: "image/png" },
    ],
    lang: "en-NP",
    name: PLATFORM_NAME,
    short_name: PLATFORM_NAME,
    start_url: "/",
    theme_color: "#0a8a4b",
  };
}
