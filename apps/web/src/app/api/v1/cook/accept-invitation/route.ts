import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { acceptCookInvitation } from "@/modules/food/cook-roster.service";
import { cookInvitationAcceptSchema } from "@/modules/food/cook.validation";

export const runtime = "nodejs";

/**
 * Public by design — the token *is* the authorisation, exactly as it is for
 * `guardian/accept-invitation`. Requiring a session first would mean asking
 * somebody to sign in to an account that does not exist yet.
 *
 * Accepting never returns a session: it either creates an account (whose
 * credentials are emailed) or upgrades one the cook already signs in with, and
 * hands off to the login screen either way.
 */
export async function POST(request: NextRequest) {
  try {
    const input = cookInvitationAcceptSchema.parse(await request.json());

    return successResponse(await acceptCookInvitation(input), "Invitation accepted");
  } catch (error) {
    return handleRouteError(error);
  }
}
