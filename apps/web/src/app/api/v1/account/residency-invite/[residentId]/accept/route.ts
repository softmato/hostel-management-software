import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { shouldExposeRefreshToken } from "@/lib/mobile-auth";
import { applySessionCookies } from "@/lib/session-cookies";
import { acceptResidencyInvite } from "@/modules/residents/residency-invite.service";

export const runtime = "nodejs";

/** "Continue" — links the account and returns a RESIDENT session, like activation. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ residentId: string }> },
) {
  try {
    const principal = await requireApiPrincipal(request);
    const { residentId } = await context.params;
    const result = await acceptResidencyInvite(principal, residentId);
    const response = successResponse(
      {
        accessToken: result.session.accessToken,
        ...(shouldExposeRefreshToken(request.headers)
          ? { refreshToken: result.session.refreshToken }
          : {}),
        residentId: result.residentId,
        user: result.session.user,
      },
      "Welcome to your hostel",
    );

    return applySessionCookies(response, result.session);
  } catch (error) {
    return handleRouteError(error);
  }
}
