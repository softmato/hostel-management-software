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
  nightStatus: "/api/v1/resident/night-status",
  notices: "/api/v1/resident/notices",
  payments: "/api/v1/resident/finance/invoices",
  /** How to pay one invoice: live checkouts, reference code, QR, bank account. */
  payInstructions: (invoiceId: string) =>
    `/api/v1/resident/finance/invoices/${invoiceId}/pay-instructions`,
  /** Starts a gateway checkout. POST — it creates an attempt and calls the provider. */
  checkout: (invoiceId: string) =>
    `/api/v1/resident/finance/invoices/${invoiceId}/checkout`,
  /** What the "checking…" screen polls. Settles nothing by being visited. */
  checkoutStatus: (reference: string) =>
    `/api/v1/resident/finance/checkout/${encodeURIComponent(reference)}`,
  profile: "/api/v1/resident/profile",
  referral: "/api/v1/resident/referral",
  /** A PDF download, not a query — never passed to `usePortalResource`. */
  receiptPdf: (receiptId: string) =>
    `/api/v1/resident/finance/receipts/${receiptId}/pdf`,
  statementPdf: "/api/v1/resident/finance/statement/pdf",
  reviews: "/api/v1/resident/reviews",
} as const;
