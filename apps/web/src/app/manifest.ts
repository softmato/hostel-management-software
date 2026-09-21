import type { MetadataRoute } from "next";

import { PLATFORM_NAME } from "@hostel/shared/brand/brand";

import { loadSeo, resolveSeoPage } from "@/lib/seo-config";

/**
 * The web app manifest: the name, icons and colour a browser uses for the site.
 *
 * `display: "standalone"` so an iPhone that adds the site to its Home Screen
 * gets an app-like window — there is no iOS app yet. Android visitors are sent
 * to the real app by `InstallAppBanner`, which also swallows Chrome's own
 * install prompt so nobody installs the lesser copy there. When the Play
 * listing is live, add it under `related_applications` with
 * `prefer_related_applications: true` as well.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { fill, seo } = await loadSeo();
  const home = resolveSeoPage(seo, "home", fill);

  return {
    background_color: "#ffffff",
    categories: ["business", "education", "lifestyle"],
    description: home.description,
    display: "standalone",
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
