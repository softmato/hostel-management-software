"use client";

import type { AvailableRoomType, Resident } from "@/app/_components/hostel-admin-shared";
import { hostelAdminEndpoints } from "@/lib/hostel-admin-endpoints";
import { usePagedPortalResource } from "@/lib/portal-pagination";
import { usePortalResource } from "@/lib/portal-query";

/**
 * Named reads for the hostel admin screens that want a hook rather than a bare
 * `usePortalResource` call.
 *
 * These route through the same url-keyed cache as every other portal read, so a
 * page that invalidates `hostelAdminEndpoints.residents` after a mutation also
 * refreshes whatever these hooks feed — one endpoint, one cache entry.
 */

export type Warden = {
  createdAt?: string;
  email: string;
  hostelId: string;
  id: string;
  name: string;
  permissions: string[];
  phone: string;
  role: string;
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "REMOVED";
  updatedAt?: string;
  userId: string;
};

/** Room types with vacancy left, for placing a new resident. */
export function useAvailableRoomTypes() {
  return usePortalResource<{ roomTypes: AvailableRoomType[] }>(
    hostelAdminEndpoints.roomTypes,
    { errorMessage: "Could not load room types." },
  );
}

/**
 * Paged — a hostel with more than one page of residents used to have the list
 * silently cut at 100 rows (API.md §1.4). Callers render
 * `<PaginationControls pagination={pagination} onPageChange={setPage} />`.
 */
export function useResidents() {
  return usePagedPortalResource<{ residents: Resident[] }>(
    hostelAdminEndpoints.residents,
    { errorMessage: "Could not load residents." },
  );
}

export type ResidentGuardian = {
  email: string;
  firstName: string;
  id: string;
  isPrimary: boolean;
  lastName: string;
  phone: string;
  relation: string;
};

export type ResidentEmergencyContact = {
  id: string;
  isPrimary: boolean;
  name: string;
  phone: string;
  relation: string;
};

/** Guardian / emergency records already saved for a resident, for prefilling. */
export function useResidentContacts(residentId: string) {
  return usePortalResource<{
    emergencyContacts: ResidentEmergencyContact[];
    guardians: ResidentGuardian[];
  }>(residentId ? hostelAdminEndpoints.residentContacts(residentId) : null, {
    errorMessage: "Could not load resident contacts.",
  });
}

export function useHostelWardens() {
  return usePagedPortalResource<{ wardens: Warden[] }>(hostelAdminEndpoints.wardens, {
    errorMessage: "Could not load wardens.",
  });
}
