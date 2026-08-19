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
 * Public website paths the app deliberately hands off to the browser.
 *
 * Everything the phone can do natively, it does natively — the whole point of
 * moving the website's header and footer into the Profile tab. These two are
 * the exceptions, and each is an exception for a reason that is about the flow
 * and not about effort:
 *
 * - **`registerHostel`** is a long multi-step application with document uploads
 *   and an ownership-papers step. It is filled in once, at a desk, usually from
 *   files that live on a computer.
 * - **`becomeProvider`** is gated on Google sign-in *before* the form, so the
 *   email on the application is one Google has verified. That gate upgrades the
 *   very account it signs in — a native flow would have to reimplement it and
 *   get the upgrade path exactly right, for a form a tradesperson fills in once.
 *
 * The app explains each of them natively and in full; only the form itself
 * leaves. `WebBrowser.openBrowserAsync` keeps the user on top of the app rather
 * than switching them to Chrome.
 */
export const WEB_PUBLIC_PATHS = {
  becomeProvider: "service-providers",
  registerHostel: "register-hostel/form",
} as const;

export type WebPublicKey = keyof typeof WEB_PUBLIC_PATHS;

/** `webPublicUrl("https://site", "registerHostel")` → `https://site/register-hostel/form`. */
export function webPublicUrl(baseUrl: string, key: WebPublicKey): string {
  return `${baseUrl.replace(/\/+$/, "")}/${WEB_PUBLIC_PATHS[key]}`;
}
