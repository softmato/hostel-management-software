import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { readBodyRefreshToken } from "@/lib/mobile-auth";
import { clearSessionCookies, readRefreshTokenCookie } from "@/lib/session-cookies";
import { logout } from "@/modules/auth/auth.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const cookieRefreshToken = readRefreshTokenCookie(request);
    const bodyRefreshToken = cookieRefreshToken
      ? null
      : await readBodyRefreshToken(request);
    const refreshToken = cookieRefreshToken ?? bodyRefreshToken;

    if (refreshToken) {
      await logout(refreshToken);
    }

    return clearSessionCookies(successResponse(null, "Logged out"));
  } catch (error) {
    return handleRouteError(error);
  }
}
