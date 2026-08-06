import { FULL_PAGE } from "@/lib/hostel-admin-endpoints";

/**
 * See `FULL_PAGE` — screens still owing a `ListPager`. Grep to find them.
 *
 * The returned URL carries a query string, so it is a *list* URL only. Never
 * build a detail or action URL by appending to one — `${listUrl}/${id}/approve`
 * yields `...?pageSize=100/<id>/approve`, which 404s or 405s instead of doing
 * anything. Use the single-resource helpers below.
 */
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
  listingFlag: (flagId: string) => `/api/v1/platform/listing-flags/${flagId}`,
  listingFlags: withFullPage("/api/v1/platform/listing-flags"),
  payments: "/api/v1/platform/payments",
  review: (reviewId: string) => `/api/v1/platform/reviews/${reviewId}`,
  reviews: withFullPage("/api/v1/platform/reviews"),
  serviceProvider: (providerId: string) =>
    `/api/v1/platform/service-providers/${providerId}`,
  /** Prefix form for `useInvalidateResources` — drops every provider detail. */
  serviceProviderDetails: "/api/v1/platform/service-providers/*",
  serviceProviders: withFullPage("/api/v1/platform/service-providers"),
  siteConfig: "/api/v1/platform/site-config",
  users: "/api/v1/platform/users",
} as const;
