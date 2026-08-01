import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { REFRESH_TOKEN_COOKIE } from "@/lib/auth";
import { readBodyRefreshToken } from "@/lib/mobile-auth";
import { clearSessionCookies } from "@/lib/session-cookies";
import { logout } from "@/modules/auth/auth.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const cookieRefreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
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
