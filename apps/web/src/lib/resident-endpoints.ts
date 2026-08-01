/**
 * Resident portal read endpoints.
 *
 * Named once so pages and their post-mutation invalidations point at the same
 * cache key — see `platformEndpoints` for the full reasoning.
 */
export const residentEndpoints = {
  complaints: "/api/v1/resident/complaints",
  dashboard: "/api/v1/resident/dashboard",
  emergencyContacts: "/api/v1/resident/emergency-contacts",
  food: "/api/v1/resident/food",
  foodPhotos: "/api/v1/resident/food/photos",
  guardians: "/api/v1/resident/guardians",
  moveChecklist: "/api/v1/resident/move-checklist",
  nightStatus: "/api/v1/resident/night-status",
  notices: "/api/v1/resident/notices",
  payments: "/api/v1/resident/payments",
  profile: "/api/v1/resident/profile",
  referral: "/api/v1/resident/referral",
  reviews: "/api/v1/resident/reviews",
} as const;
