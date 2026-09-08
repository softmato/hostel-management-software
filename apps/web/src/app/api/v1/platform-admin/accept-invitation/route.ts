import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { acceptPlatformAdminInvitation } from "@/modules/users/platform-admin-invite.service";
import { platformAdminInvitationAcceptSchema } from "@/modules/users/platform-admin.validation";

export const runtime = "nodejs";

/**
 * Public, token-authorised — the sibling of `cook/accept-invitation`.
 *
 * Accepting never returns a session. It creates or raises the account and hands
 * off to the login screen, so the new role is exercised only after a real
 * sign-in with the password the recipient just chose.
 */
export async function POST(request: NextRequest) {
  try {
    const input = platformAdminInvitationAcceptSchema.parse(await request.json());

    return successResponse(
      await acceptPlatformAdminInvitation(input),
      "Invitation accepted",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
