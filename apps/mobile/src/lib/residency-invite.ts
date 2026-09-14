import { api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";
import type { ApiUser } from "@/lib/auth-api";

/**
 * "Your hostel added you as a resident — is this you?" Mirrors
 * `apps/web/src/modules/residents/residency-invite.service.ts`, which decides who
 * is asked; read that, not this, when the two disagree.
 */

/** The push `data.type` that means "ask now". Frozen with `existing-resident-notify.ts`. */
export const RESIDENCY_INVITE = "RESIDENCY_INVITE";

export type ResidencyInvite = {
  dueAmount: number;
  firstName: string;
  hostelName: string;
  paidTill: string | null;
  residentId: string;
  roomType: string;
};

export async function getResidencyInvite() {
  return unwrap(
    await api.get<ApiEnvelope<{ invite: ResidencyInvite | null }>>("/account/residency-invite"),
  ).invite;
}

/** Continue — returns a fresh session whose token already says RESIDENT. */
export async function acceptResidencyInvite(residentId: string) {
  return unwrap(
    await api.post<
      ApiEnvelope<{ accessToken: string; refreshToken: string; residentId: string; user: ApiUser }>
    >(`/account/residency-invite/${residentId}/accept`),
  );
}

export async function declineResidencyInvite(residentId: string) {
  await api.post(`/account/residency-invite/${residentId}/decline`);
}

/** `Rs 26,500 due`, `All clear till Aswin 2083`. */
export function inviteRentLine(invite: Pick<ResidencyInvite, "dueAmount" | "paidTill">) {
  if (invite.dueAmount > 0) {
    return `Rs ${invite.dueAmount.toLocaleString("en-IN")} due`;
  }

  return invite.paidTill ? `All clear till ${invite.paidTill}` : "All clear";
}
