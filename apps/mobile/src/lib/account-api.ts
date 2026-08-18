/**
 * Account deletion — `GET/POST /users/account-deletion`.
 *
 * Typed off `account-deletion.service.ts`'s `getAccountDeletionStatus` and
 * `resolvePathway`, and `accountDeletionRequestSchema`.
 *
 * ## The server decides what "delete my account" means
 *
 * `resolvePathway` reads the role and the account's attachments and returns one of
 * four answers. The client never guesses: it renders the pathway it is given, with
 * that pathway's own copy, because the consequence is different in each case —
 * a guardian loses access to a resident rather than their account, and a hostel
 * admin starts a conversation with the platform rather than a countdown.
 *
 * **A resident living in a hostel is `BLOCKED`**, which makes it the most likely
 * pathway on this app: `ACTIVE` and `PENDING` residencies both block, and the
 * account becomes deletable after they move out.
 */

import type { DeletionPathway } from "@/lib/account-pathways";
import { api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";

export type DeletionRequest = {
  kind: string;
  reason: string;
  requestedAt: string;
  reviewStatus?: string;
  scheduledDeletionAt?: string;
};

export type DeletionStatus = {
  /** Set only on `BLOCKED`, and it is the sentence to show. */
  blockedReason?: string;
  graceperiodDays: number;
  /** Named on `PLATFORM_REVIEW` so the owner can see what hangs off the account. */
  hostelNames: string[];
  pathway: DeletionPathway;
  /** An already-open request. Its presence replaces the whole action. */
  request: DeletionRequest | null;
};

export async function getDeletionStatus() {
  const response = await api.get<ApiEnvelope<DeletionStatus>>("/users/account-deletion");

  return unwrap(response);
}

/**
 * **201.** `reason` is required and **min 10 characters** after trimming — the
 * minimum exists so a single character cannot satisfy a field the platform owner
 * has to read and act on (PRIVACY_POLICY.md §8.1).
 *
 * The response carries the server's own `message`, which differs by pathway, so
 * show that rather than a string of our own.
 */
export async function requestAccountDeletion(reason: string) {
  const response = await api.post<
    ApiEnvelope<{ pathway: DeletionPathway; request: DeletionRequest }> & {
      message: string;
    }
  >("/users/account-deletion", { reason });

  return { data: unwrap(response), message: response.data.message };
}
