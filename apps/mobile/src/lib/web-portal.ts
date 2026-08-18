/**
 * Deep links into the web hostel portal, for everything the mobile admin
 * surface deliberately does not do.
 *
 * ## The URLs are tenant-scoped, and that is easy to get wrong
 *
 * `portal-nav.ts` still *declares* its hrefs as `/hostel-admin/payments`, but
 * that prefix is legacy: `tenantHostelAdminHref` rewrites every one of them to
 * `/{slug}/admin/payments` before it is rendered, and `/{hostelSlug}/admin` is
 * the only route group that exists in `apps/web/src/app/(hostel-admin)/`. So a
 * mobile link built from the declared href lands on a 404 for every hostel.
 * This module builds the rewritten form and nothing else.
 *
 * ## Why a table rather than free-form strings at call sites
 *
 * Each entry is one place the phone stops and the desktop takes over, so the
 * list doubles as the statement of what admin-lite is *not*. Adding a key here
 * should feel like a decision.
 */

/** Path under `/{slug}/admin`. Empty string means the portal root. */
export const WEB_PORTAL_PATHS = {
  complaints: "complaints",
  dashboard: "dashboard",
  finance: "payments",
  foodRoutine: "food",
  inquiries: "inquiries",
  maintenance: "maintenance",
  notices: "notices",
  reports: "reports",
  residents: "residents",
  rooms: "rooms",
  settings: "settings",
  sosAlerts: "sos-alerts",
} as const;

export type WebPortalKey = keyof typeof WEB_PORTAL_PATHS;

/**
 * `webPortalUrl("https://site", "green-view-hostel", "finance")`
 * → `https://site/green-view-hostel/admin/payments`.
 *
 * Trailing slashes on `baseUrl` are stripped rather than trusted: it comes from
 * `EXPO_PUBLIC_API_URL` or the dev machine's LAN address, and a stray slash
 * would produce a `//` path that some hosts redirect and others 404.
 */
export function webPortalUrl(baseUrl: string, slug: string, key: WebPortalKey): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = WEB_PORTAL_PATHS[key];

  return `${base}/${slug}/admin${path ? `/${path}` : ""}`;
}
