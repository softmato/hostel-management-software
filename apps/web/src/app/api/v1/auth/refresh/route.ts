import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { REFRESH_TOKEN_COOKIE } from "@/lib/auth";
import { readBodyRefreshToken, shouldExposeRefreshToken } from "@/lib/mobile-auth";
import { applySessionCookies } from "@/lib/session-cookies";
import { AuthServiceError, refreshAccessToken } from "@/modules/auth/auth.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const cookieRefreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    const bodyRefreshToken = cookieRefreshToken
      ? null
      : await readBodyRefreshToken(request);
    const refreshToken = cookieRefreshToken ?? bodyRefreshToken;

    if (!refreshToken) {
      return errorResponse("Refresh token is missing.", "UNAUTHENTICATED", 401);
    }

    const result = await refreshAccessToken(refreshToken);
    const response = successResponse(
      {
        accessToken: result.accessToken,
        ...(shouldExposeRefreshToken(request.headers)
          ? { refreshToken: result.refreshToken }
          : {}),
        user: result.user,
      },
      "Token refreshed",
    );

    // Mobile passes the token in the body and stores the rotated one itself;
    // only a cookie-based session gets the rotated pair written back.
    if (cookieRefreshToken) {
      applySessionCookies(response, result);
    }

    return response;
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return errorResponse(error.message, error.errorCode, error.status);
    }

    return handleRouteError(error);
  }
}
