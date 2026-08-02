import { FULL_PAGE } from "@/lib/hostel-admin-endpoints";

/** See `FULL_PAGE` — screens still owing a `ListPager`. Grep to find them. */
function withFullPage(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${FULL_PAGE}`;
}

/**
 * Platform (superadmin) read endpoints.
 *
 * Cached reads are keyed by url, so a literal typed slightly differently in two
 * places silently becomes a second cache entry — and an invalidation that
 * misses. Naming them once keeps pages and their post-mutation invalidations
 * pointing at the same key.
 */
export const platformEndpoints = {
  admins: "/api/v1/platform/admins",
  auditLogs: "/api/v1/platform/audit-logs",
  complaints: withFullPage("/api/v1/platform/complaints"),
  currentUser: "/api/v1/auth/me",
  dashboardReport: "/api/v1/platform/reports/dashboard",
  hostel: (hostelId: string) => `/api/v1/platform/hostels/${hostelId}`,
  /** Prefix form for `useInvalidateResources` — drops every hostel detail. */
  hostelDetails: "/api/v1/platform/hostels/*",
  hostels: withFullPage("/api/v1/platform/hostels"),
  listingFlags: withFullPage("/api/v1/platform/listing-flags"),
  payments: "/api/v1/platform/payments",
  reviews: withFullPage("/api/v1/platform/reviews"),
  serviceProviders: withFullPage("/api/v1/platform/service-providers"),
  siteConfig: "/api/v1/platform/site-config",
  users: "/api/v1/platform/users",
} as const;
