/**
 * `GET`/`POST /resident/guardians`, `PATCH`/`DELETE /resident/guardians/{accessId}`.
 *
 * Split from `guardian-access.ts` so the types and the display rules there stay
 * importable by the node-only test runner — `lib/api` pulls in `react-native`,
 * whose Flow source vitest cannot parse. Everything shaped lives in that file;
 * this one only makes the four calls.
 */

import { api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";
import type { GuardianLink, GuardianPermissions } from "@/lib/guardian-access";

/** `GET /resident/guardians` — newest link first, already sorted by the server. */
export async function listGuardians() {
  const response =
    await api.get<ApiEnvelope<{ guardians: GuardianLink[] }>>("/resident/guardians");

  return unwrap(response).guardians;
}

/**
 * `POST /resident/guardians` (`guardianInviteSchema`).
 *
 * **Re-inviting the same email replaces the previous link.** The service revokes
 * every `ACTIVE` access for that guardian before minting a new one — "one live
 * invitation per guardian" — so this doubles as *resend*, and the screen says so
 * rather than offering a separate resend button for a route that is this one.
 *
 * The guardian record is matched on `{ email, hostelId, residentId }`, so a
 * second invite to the same address reuses the person and only the access is
 * new. A different email is a different guardian, even for the same human.
 */
export async function inviteGuardian(input: {
  email: string;
  firstName: string;
  lastName: string;
  permissions: GuardianPermissions;
  phone: string;
  relation: string;
}) {
  const response = await api.post<ApiEnvelope<{ guardian: GuardianLink }>>(
    "/resident/guardians",
    input,
  );

  return unwrap(response).guardian;
}

/**
 * `PATCH /resident/guardians/{accessId}` — a **partial** update.
 *
 * `guardianPermissionsUpdateSchema` is `.partial()` and the service `$set`s only
 * the keys it is given, so sending one flag changes one flag. That is what lets
 * a switch row send `{ canViewFood: true }` rather than the whole object and
 * risk writing back five stale values from a screen that has been open a while.
 *
 * Returns the **server's** full permission set afterwards, not the patch — so
 * the screen settles on what is actually stored rather than on what it
 * optimistically drew.
 */
export async function updateGuardianPermissions(
  accessId: string,
  input: Partial<GuardianPermissions>,
) {
  const response = await api.patch<ApiEnvelope<{ permissions: GuardianPermissions }>>(
    `/resident/guardians/${accessId}`,
    input,
  );

  return unwrap(response).permissions;
}

/**
 * `DELETE /resident/guardians/{accessId}`.
 *
 * Sets the access to `REVOKED` and drops the invitation token, so an emailed
 * link that has not been clicked stops working too. There is no undo: the
 * guardian has to be invited again, which mints a new access and a new code.
 */
export async function revokeGuardian(accessId: string) {
  const response = await api.delete<
    ApiEnvelope<{ accessId: string; status: "REVOKED" }>
  >(`/resident/guardians/${accessId}`);

  return unwrap(response);
}
