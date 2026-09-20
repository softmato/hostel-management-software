import type { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  LEGACY_ACCESS_TOKEN_COOKIES,
  LEGACY_REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  accessTokenTtlSeconds,
  readRefreshTokenCookieValue,
  refreshTokenTtlSeconds,
} from "@/lib/auth";

const LEGACY_REFRESH_COOKIE_PATH = "/api";

/**
 * The pre-rename cookies that sat at "/", alongside their replacements.
 *
 * `LEGACY_REFRESH_TOKEN_COOKIE` is deliberately not in here: it lives at "/api"
 * and is cleared at that path instead, below.
 */
const RENAMED_ROOT_PATH_COOKIES = [
  ...LEGACY_ACCESS_TOKEN_COOKIES,
  "hostelhub_refresh",
] as const;

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
  return readRefreshTokenCookieValue(request.cookies);
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

  // The pre-rename pair goes the moment a new one is written, so a browser
  // never carries both. Left in place they would outlive the session they
  // belong to and keep being offered to `readAccessTokenCookie` as a fallback
  // long after they stopped being valid.
  for (const name of RENAMED_ROOT_PATH_COOKIES) {
    response.cookies.set(name, "", cookieOptions(0));
  }

  return response;
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set(ACCESS_TOKEN_COOKIE, "", cookieOptions(0));
  response.cookies.set(REFRESH_TOKEN_COOKIE, "", cookieOptions(0));

  // Signing out has to reach every spelling, or the next request reads a
  // pre-rename cookie through the fallback and the person is still signed in.
  for (const name of RENAMED_ROOT_PATH_COOKIES) {
    response.cookies.set(name, "", cookieOptions(0));
  }

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
