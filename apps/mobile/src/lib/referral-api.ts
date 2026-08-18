/**
 * Referrals — `GET /resident/referral`.
 *
 * Typed off `serializeReferralCode` / `serializeReferral` / `serializeReward` in
 * `apps/web/src/modules/referrals/referral.service.ts`.
 *
 * ## The GET mints the code
 *
 * `getResidentReferral` creates a `ReferralCode` when the resident has none —
 * inside a GET. So there is nothing for the client to "generate": opening the
 * screen is what allocates the code, and a resident who has never referred anyone
 * still gets a real one on first load. Nothing else about the response is a
 * side effect.
 *
 * ## Rewards are informational
 *
 * Nothing pays out automatically. `ReferralReward` rows are what a hostel admin
 * has recorded by hand, which is why the numbers are presented as "what your
 * hostel has recorded" rather than a balance.
 */

import { api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";
import type { ResidentSummary } from "@/lib/resident-api";

/** `Referral.status`. `INQUIRY_CREATED` is the default on creation. */
export type ReferralStatus = "CANCELLED" | "INQUIRY_CREATED" | "JOINED" | "REWARDED";

export type RewardStatus = "APPROVED" | "CANCELLED" | "PAID" | "PENDING";

export type RewardType = "CASH" | "DISCOUNT" | "OTHER" | "SERVICE_CREDIT";

export type ReferralReward = {
  amount: number;
  approvedAt?: string;
  approvedBy?: string;
  hostelId: string;
  id: string;
  notes: string;
  referralId: string;
  referrerResidentId: string;
  rewardType: RewardType;
  status: RewardStatus;
};

export type Referral = {
  confirmedAt?: string;
  confirmedBy?: string;
  /**
   * Their first payment has been verified. Tracked **separately** from `status`,
   * so a `JOINED` referral may or may not be converted — the two are not stages
   * of one enum.
   */
  converted: boolean;
  convertedAt?: string;
  createdAt?: string;
  email: string;
  hostelId: string;
  id: string;
  inquiryId?: string;
  joinedResidentId?: string;
  message: string;
  name: string;
  phone: string;
  referralCodeId: string;
  referrerResidentId: string;
  /** Attached by the list endpoint; `null` until an admin records one. */
  reward: ReferralReward | null;
  status: ReferralStatus;
  updatedAt?: string;
};

export type ReferralCode = {
  code: string;
  convertedCount: number;
  createdAt?: string;
  hostelId: string;
  id: string;
  joinedCount: number;
  /** **Relative** — `/inquiry?ref=<code>`. See `lib/referrals.ts`. */
  link: string;
  residentId: string;
  rewardCount: number;
  status: string;
  updatedAt?: string;
  userId: string;
};

export type ReferralSummary = {
  /** First payment verified. The only number tied to real money. */
  converted: number;
  joined: number;
  rewardApprovedAmount: number;
  rewardPaidAmount: number;
  /** Referrals raised. Not "messages sent" — nothing counts a share. */
  sent: number;
};

export type ResidentReferral = {
  referralCode: ReferralCode;
  /** Newest first, capped at 50 by the service. */
  referrals: Referral[];
  resident: ResidentSummary;
  summary: ReferralSummary;
};

export async function getResidentReferral() {
  const response = await api.get<ApiEnvelope<ResidentReferral>>("/resident/referral");

  return unwrap(response);
}
