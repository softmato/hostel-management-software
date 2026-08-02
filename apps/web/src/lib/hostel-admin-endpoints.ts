import { MAX_PAGE_SIZE } from "@/lib/pagination";

/**
 * Hostel admin (tenant) read endpoints.
 *
 * Same reasoning as `platformEndpoints`: cached reads are keyed by url, so a
 * literal typed slightly differently in two places silently becomes a second
 * cache entry — and an invalidation that misses. Naming them once keeps pages
 * and their post-mutation invalidations pointing at the same key.
 */

/**
 * Explicit full page for screens that have not been given a pager yet.
 *
 * List endpoints default to 20 rows per page (API.md §1.4). A screen that
 * renders the rows but has no page control would therefore show 20 and give the
 * user no way to reach the rest — worse than the old behaviour, which at least
 * showed 100. Asking for the maximum keeps those screens exactly as they were
 * until each one gets a `ListPager`.
 *
 * **Grep for `FULL_PAGE` to find the screens still owing a pager** — the goal is
 * that every use of this disappears. Tracked in TODO.md B1.
 */
export const FULL_PAGE = `pageSize=${MAX_PAGE_SIZE}`;

function withFullPage(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${FULL_PAGE}`;
}
export const hostelAdminEndpoints = {
  complaints: (filters?: { category?: string; status?: string }) => {
    const params = new URLSearchParams();

    if (filters?.status) params.set("status", filters.status);
    if (filters?.category) params.set("category", filters.category);

    return withFullPage(
      params.size > 0
        ? `/api/v1/hostel-admin/complaints?${params.toString()}`
        : "/api/v1/hostel-admin/complaints",
    );
  },
  /** Prefix form for `useInvalidateResources` — drops every filter combination. */
  complaintsAll: "/api/v1/hostel-admin/complaints*",
  complaintsReport: "/api/v1/hostel-admin/reports/complaints",
  cookPortal: "/api/v1/hostel-admin/cook-portal",
  dashboardReport: "/api/v1/hostel-admin/reports/dashboard",
  foodRoutine: "/api/v1/hostel-admin/food/routine",
  foodPhotos: "/api/v1/hostel-admin/food/photos",
  inquiries: withFullPage("/api/v1/hostel-admin/inquiries"),
  maintenanceReport: "/api/v1/hostel-admin/reports/maintenance",
  maintenanceRequests: "/api/v1/hostel-admin/maintenance/requests",
  moveEvents: "/api/v1/hostel-admin/move-events",
  nightStatus: withFullPage("/api/v1/hostel-admin/night-status"),
  notices: withFullPage("/api/v1/hostel-admin/notices"),
  paymentsMatrix: (month: string) =>
    `/api/v1/hostel-admin/payments/matrix?month=${month}`,
  /** Prefix form for `useInvalidateResources` — drops every month. */
  paymentsMatrixAll: "/api/v1/hostel-admin/payments/matrix*",
  paymentsReport: "/api/v1/hostel-admin/reports/payments",
  profile: "/api/v1/hostel-admin/profile",
  /** `near` disambiguates a bare place name with the hostel's saved locality. */
  profileGeocode: (query: string, near?: string) =>
    `/api/v1/hostel-admin/profile/geocode?q=${encodeURIComponent(query)}` +
    (near ? `&near=${encodeURIComponent(near)}` : ""),
  /** Reverse direction — what address the pin sits on. */
  profileReverseGeocode: (lat: number, lng: number) =>
    `/api/v1/hostel-admin/profile/geocode?lat=${lat}&lng=${lng}`,
  referrals: withFullPage("/api/v1/hostel-admin/referrals"),
  reportsOverview: (month?: string) =>
    month
      ? `/api/v1/hostel-admin/reports/overview?month=${month}`
      : "/api/v1/hostel-admin/reports/overview",
  /** Prefix form for `useInvalidateResources` — drops every month. */
  reportsOverviewAll: "/api/v1/hostel-admin/reports/overview*",
  residentContacts: (residentId: string) =>
    `/api/v1/hostel-admin/residents/${residentId}/contacts`,
  residentFees: "/api/v1/hostel-admin/residents/fees",
  residents: "/api/v1/hostel-admin/residents",
  roomTypes: "/api/v1/hostel-admin/room-types",
  serviceProviders: withFullPage("/api/v1/hostel-admin/service-providers"),
  sosAlerts: withFullPage("/api/v1/hostel-admin/sos-alerts"),
  transactions: withFullPage("/api/v1/hostel-admin/payments"),
  wardens: "/api/v1/hostel-admin/wardens",
} as const;
