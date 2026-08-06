/**
 * Canonical public base URL for absolute links (SEO metadata, sitemap, robots).
 * Falls back to localhost for local dev. Trailing slash stripped so callers can
 * safely template `${siteUrl()}/path`.
 */
export function siteUrl() {
  const raw =
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return raw.replace(/\/+$/, "");
}
