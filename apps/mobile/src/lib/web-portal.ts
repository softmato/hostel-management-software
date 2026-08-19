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

/**
 * There is no public website path the app hands off to any more.
 *
 * `WEB_PUBLIC_PATHS` used to live here with two entries — `registerHostel` and
 * `becomeProvider` — each with an argument for why its form could not be native.
 * Both arguments were retired on 2026-08-19 and the forms are now
 * `app/register-hostel/apply.tsx` and `app/service-providers/apply.tsx`; those
 * two files carry the reasoning, which is worth reading before anything is added
 * back here.
 *
 * The short version: "the documents live on a computer" was wrong about where a
 * Nepali hostel owner's citizenship certificate actually is, and "the Google gate
 * has to happen before the form" describes a problem the app has already solved
 * by having a session at all.
 *
 * `WEB_PORTAL_PATHS` above is a different thing and stays: those are *hostel
 * admin* surfaces the phone deliberately does not reimplement, not public forms
 * it could not manage.
 */
