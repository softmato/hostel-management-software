/**
 * Reading a resident's ID card — `GET /hostel-admin/resident-scan` and `/photo`.
 *
 * Typed off `modules/users/resident-scan.service.ts`. Two things about that
 * endpoint decide the shape of every screen that consumes it, and both are
 * deliberate:
 *
 * ## Almost nothing is fatal
 *
 * Its sibling `/hostel-admin/resident-lookup` — the one the registration form
 * uses — refuses a provider's card, an unfinished profile and a holder who has
 * turned sharing off. This route refuses none of them. `profile` and
 * `membership` are independently nullable and each comes with its own
 * `…Notice` sentence saying which half is missing and why, so the dossier screen
 * renders a reason where the data would have been rather than an error state
 * over the whole page.
 *
 * The one real error is an id no account carries (404), because there is then
 * nobody to describe.
 *
 * ## The money can be refused on its own
 *
 * `ledger` is null with `ledgerDenied: true` when the signed-in warden has no
 * `viewPayments` grant. That is a normal answer, not a failure — the rest of the
 * dossier is still there and the screen says whose permission is missing.
 */

import { API_BASE_URL, api } from "@/lib/api";
import type { ResidentLedger } from "@/lib/admin-manage-api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";

export type ScannedCardType = "HOSTEL_OWNER" | "RESIDENT" | "SERVICE_PROVIDER";

/** `UserResidentProfile`, decrypted, plus the age the server works out for us. */
export type ScannedProfile = {
  age: number | null;
  alternatePhone?: string;
  backupEmail?: string;
  bloodGroup: string;
  budgetRange?: string;
  city?: string;
  courseOrDesignation?: string;
  dateOfBirth?: string;
  dietaryPreference: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  fullName: string;
  gender: string;
  governmentIdNumber?: string;
  governmentIdType?: string;
  guardianEmail?: string;
  guardianName: string;
  guardianPhone: string;
  guardianRelation: string;
  institution?: string;
  interests: string[];
  medicalNotes?: string;
  occupation: string;
  permanentAddress?: string;
  primaryEmail: string;
  primaryPhone: string;
  province?: string;
  secondGuardianEmail?: string;
  secondGuardianName?: string;
  secondGuardianPhone?: string;
  secondGuardianRelation?: string;
};

export type ScannedMembership = {
  complaints: {
    open: number;
    recent: {
      category: string;
      createdAt: string | null;
      id: string;
      status: string;
      title: string;
    }[];
    total: number;
  };
  contacts: {
    emergencyContacts: {
      id: string;
      isPrimary: boolean;
      name: string;
      phone: string;
      relation: string;
    }[];
    guardians: {
      email: string;
      firstName: string;
      id: string;
      isPrimary: boolean;
      lastName: string;
      phone: string;
      relation: string;
    }[];
  };
  hostel: { id: string; name: string };
  /** Null when refused — check `ledgerDenied` before saying "no payments yet". */
  ledger: ResidentLedger | null;
  ledgerDenied: boolean;
  /**
   * `ACCOUNT` means the tenancy row points at this exact user. `PHONE` and
   * `EMAIL` mean it was matched on a detail from the scanned profile, because
   * that person never redeemed an activation code — the normal case for anyone
   * registered at the desk. The screen says which, since the weaker two are a
   * "probably them".
   */
  matchedBy: "ACCOUNT" | "EMAIL" | "PHONE";
  nightStatus: {
    checkedAt: string | null;
    note: string | null;
    source: string;
    status: string;
  } | null;
  resident: {
    createdAt: string | null;
    depositAmount: number;
    email: string | null;
    firstName: string;
    id: string;
    lastName: string;
    /** Null is "no override" — the fee schedule governs. Zero is a free stay. */
    monthlyFee: number | null;
    moveInDate: string;
    phone: string;
    residentType: string;
    roomType: string;
    status: string;
    userId: string | null;
  };
};

export type ResidentScan = {
  account: {
    cardRole: string | null;
    cardType: ScannedCardType;
    email: string | null;
    hasPhoto: boolean;
    name: string;
    photoUpdatedAt: string | null;
  };
  membership: ScannedMembership | null;
  membershipNotice: string | null;
  profile: ScannedProfile | null;
  profileNotice: string | null;
  residentId: string;
  scannedAt: string;
};

/**
 * Accepts anything the camera or a warden's thumbs produce: `HH-4K7M-9XQ2`,
 * `hh4k7m9xq2`, or the full `…/resident-id/HH-4K7M-9XQ2` URL the QR actually
 * encodes. `normalizeResidentId` on the server does the parsing.
 */
export async function scanResident(residentId: string) {
  const response = await api.get<ApiEnvelope<ResidentScan>>("/hostel-admin/resident-scan", {
    params: { residentId },
  });

  return unwrap(response);
}

/**
 * An `<Image source>` for the scanned holder's card photo.
 *
 * Deliberately not `privateAssetSource`: this route streams the bytes through
 * our origin rather than redirecting to R2, so the bearer token has no hop to be
 * stripped on. `v=` is the cache key — `expo-image` keys its disk cache on the
 * URL, so without it a replaced portrait would show the old face until reinstall.
 */
export function scannedPhotoSource(
  scan: Pick<ResidentScan, "account" | "residentId">,
  token: string | null | undefined,
) {
  if (!scan.account.hasPhoto) {
    return null;
  }

  const version = encodeURIComponent(scan.account.photoUpdatedAt ?? "1");
  const id = encodeURIComponent(scan.residentId);

  return {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    uri: `${API_BASE_URL}/api/v1/hostel-admin/resident-scan/photo?residentId=${id}&v=${version}`,
  };
}
