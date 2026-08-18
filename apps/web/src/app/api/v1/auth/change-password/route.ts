import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { rateLimitAuthAttempts } from "@/lib/rate-limit";
import { ACCESS_TOKEN_COOKIE, getBearerToken, verifyAccessToken } from "@/lib/auth";
import { shouldExposeRefreshToken } from "@/lib/mobile-auth";
import { applySessionCookies } from "@/lib/session-cookies";
import { AuthServiceError, changePassword } from "@/modules/auth/auth.service";
import { changePasswordSchema } from "@hostel/shared/schemas/auth.schema";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // The current password is checked here, so it is a guessing surface.
    const limited = rateLimitAuthAttempts(request, "auth-change-password");

    if (limited) {
      return limited;
    }

    const accessToken =
      getBearerToken(request.headers.get("authorization")) ??
      request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;

    if (!accessToken) {
      return errorResponse("Access token is missing.", "UNAUTHENTICATED", 401);
    }

    const payload = await verifyAccessToken(accessToken).catch(() => null);

    if (!payload?.sub) {
      return errorResponse("Access token is invalid.", "UNAUTHENTICATED", 401);
    }

    // A borrowed login must not be able to lock the owner out of their own
    // account — and `changePassword` revokes every session, so it would.
    if (payload.temporaryCredentialId) {
      return errorResponse(
        "A temporary login cannot change the account password.",
        "TEMPORARY_CREDENTIAL_FORBIDDEN",
        403,
      );
    }

    const input = changePasswordSchema.parse(await request.json());
    const result = await changePassword(payload.sub, input, {
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    const response = successResponse(
      {
        accessToken: result.accessToken,
        ...(shouldExposeRefreshToken(request.headers)
          ? { refreshToken: result.refreshToken }
          : {}),
        user: result.user,
      },
      "Password changed",
    );

    return applySessionCookies(response, result);
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return errorResponse(error.message, error.errorCode, error.status);
    }

    return handleRouteError(error);
  }
}
