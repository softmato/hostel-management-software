import type { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  LEGACY_REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  accessTokenTtlSeconds,
  refreshTokenTtlSeconds,
} from "@/lib/auth";

const LEGACY_REFRESH_COOKIE_PATH = "/api";

function cookieOptions(maxAge: number, path = "/") {
  return {
    httpOnly: true,
    maxAge,
    path,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function readRefreshTokenCookie(request: NextRequest) {
  return (
    request.cookies.get(REFRESH_TOKEN_COOKIE)?.value ??
    request.cookies.get(LEGACY_REFRESH_TOKEN_COOKIE)?.value
  );
}

/**
 * `refreshToken: null` is a reuse-window refresh (see `refreshAccessToken`):
 * only the access cookie is renewed and the refresh cookie the winning request
 * wrote is left alone.
 */
export function applySessionCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string | null },
) {
  response.cookies.set(
    ACCESS_TOKEN_COOKIE,
    tokens.accessToken,
    cookieOptions(accessTokenTtlSeconds()),
  );

  if (tokens.refreshToken) {
    response.cookies.set(
      REFRESH_TOKEN_COOKIE,
      tokens.refreshToken,
      cookieOptions(refreshTokenTtlSeconds()),
    );
    response.cookies.set(
      LEGACY_REFRESH_TOKEN_COOKIE,
      "",
      cookieOptions(0, LEGACY_REFRESH_COOKIE_PATH),
    );
  }

  return response;
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set(ACCESS_TOKEN_COOKIE, "", cookieOptions(0));
  response.cookies.set(REFRESH_TOKEN_COOKIE, "", cookieOptions(0));
  response.cookies.set(
    LEGACY_REFRESH_TOKEN_COOKIE,
    "",
    cookieOptions(0, LEGACY_REFRESH_COOKIE_PATH),
  );

  // `response.cookies` keeps one entry per name, so the older "/api/v1/auth"
  // copy of the legacy cookie is appended raw, after every `cookies.set`.
  response.headers.append(
    "Set-Cookie",
    `${LEGACY_REFRESH_TOKEN_COOKIE}=; Path=/api/v1/auth; Max-Age=0; HttpOnly; SameSite=Lax${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );

  return response;
}
