import { publicApi } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";

/**
 * Accepting a cook invitation — the one cook call a signed-out phone makes.
 *
 * It lives apart from `admin-manage-api.ts` for the same reason
 * `acceptGuardianInvitation` lives apart from the guardian dashboard: that
 * module is the *admin's* half of the roster and every call in it needs a
 * session. This one is opened from an email by somebody who has no account
 * yet.
 */

export type CookInvitationResult = {
  accepted: true;
  accountCreated: boolean;
  email: string;
  hostelName: string;
  /**
   * True when this call created or upgraded the account — credentials were
   * emailed and the cook now signs in with them. **No session is issued here**:
   * opening a link proves control of a mailbox, not identity, so the screen
   * hands off to login rather than pretending to land them in the app.
   */
  requiresLogin: boolean;
};

/**
 * `POST /cook/accept-invitation` — **on `publicApi`, deliberately.**
 *
 * The authenticated client's 401 interceptor must not see this. A stale or
 * reused token would otherwise trigger a refresh-and-sign-out cycle against a
 * route that never needed a session, logging out whoever happened to be signed
 * in on the handset.
 *
 * Single-use: accepting clears the token, so a second tap on the same link
 * returns `COOK_INVITATION_INVALID` rather than a second acceptance.
 */
export async function acceptCookInvitation(input: { name?: string; token: string }) {
  const response = await publicApi.post<ApiEnvelope<CookInvitationResult>>(
    "/cook/accept-invitation",
    input,
  );

  return unwrap(response);
}
