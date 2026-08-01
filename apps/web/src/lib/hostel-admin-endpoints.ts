/**
 * Hostel admin (tenant) read endpoints.
 *
 * Same reasoning as `platformEndpoints`: cached reads are keyed by url, so a
 * literal typed slightly differently in two places silently becomes a second
 * cache entry — and an invalidation that misses. Naming them once keeps pages
 * and their post-mutation invalidations pointing at the same key.
 */
export const hostelAdminEndpoints = {
  complaints: (filters?: { category?: string; status?: string }) => {
    const params = new URLSearchParams();

    if (filters?.status) params.set("status", filters.status);
    if (filters?.category) params.set("category", filters.category);

    return params.size > 0
      ? `/api/v1/hostel-admin/complaints?${params.toString()}`
      : "/api/v1/hostel-admin/complaints";
  },
  /** Prefix form for `useInvalidateResources` — drops every filter combination. */
  complaintsAll: "/api/v1/hostel-admin/complaints*",
  complaintsReport: "/api/v1/hostel-admin/reports/complaints",
  cookPortal: "/api/v1/hostel-admin/cook-portal",
  dashboardReport: "/api/v1/hostel-admin/reports/dashboard",
  foodRoutine: "/api/v1/hostel-admin/food/routine",
  foodPhotos: "/api/v1/hostel-admin/food/photos",
  inquiries: "/api/v1/hostel-admin/inquiries",
  maintenanceReport: "/api/v1/hostel-admin/reports/maintenance",
  maintenanceRequests: "/api/v1/hostel-admin/maintenance/requests",
  moveEvents: "/api/v1/hostel-admin/move-events",
  nightStatus: "/api/v1/hostel-admin/night-status",
  notices: "/api/v1/hostel-admin/notices",
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
  referrals: "/api/v1/hostel-admin/referrals",
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
  serviceProviders: "/api/v1/hostel-admin/service-providers",
  sosAlerts: "/api/v1/hostel-admin/sos-alerts",
  transactions: "/api/v1/hostel-admin/payments",
  wardens: "/api/v1/hostel-admin/wardens",
} as const;
