export const ACCESS_TOKEN_COOKIE = "hostelpalika_access_token";
/*
 * Path "/" so the proxy can see it and refresh an expired access token before a
 * page load, instead of bouncing a signed-in user to /login every 15 minutes.
 * It is a new name rather than the old one at a new path: two same-named
 * cookies at "/" and "/api" would both reach /api/v1/auth/refresh and the stale
 * one could be read first.
 */
export const REFRESH_TOKEN_COOKIE = "hostelpalika_refresh";

/*
 * Every older spelling of the same two cookies, newest first.
 *
 * There are two separate reasons a name here is old, and they are not the same
 * migration:
 *
 * - `hostelhub_*` is the **rename**. The product is HostelPalika everywhere a
 *   user can see, and these were the last internal identifiers carrying the old
 *   name. A browser holding one is a signed-in person, and dropping the name
 *   without reading it first is a silent mass logout — so they are read as a
 *   fallback and cleared the moment a new pair is written.
 * - `hostelhub_refresh_token` predates the rename entirely: it is the
 *   pre-proxy-refresh cookie, scoped to "/api" rather than "/", which is why it
 *   has its own constant and its own clearing path below.
 *
 * These can be deleted once every live session has rotated through a refresh —
 * see `refreshTokenTtlSeconds()` for how long that is.
 */
export const LEGACY_ACCESS_TOKEN_COOKIES = ["hostelhub_access_token"] as const;
export const LEGACY_REFRESH_TOKEN_COOKIES = [
  "hostelhub_refresh",
  "hostelhub_refresh_token",
] as const;

/** The pre-proxy-refresh cookie, scoped to "/api". Read as a fallback, cleared on sight. */
export const LEGACY_REFRESH_TOKEN_COOKIE = "hostelhub_refresh_token";

/**
 * The shape both cookie stores share — `NextRequest.cookies` and the one
 * `next/headers` hands back — so a reader works against either without caring
 * which it was given.
 */
type CookieReader = { get(name: string): { value: string } | undefined };

/**
 * The access token, under whichever name this browser happens to be holding.
 *
 * Every read site goes through here rather than reaching for the constant:
 * during a rename the constant alone is exactly the bug, because it is correct
 * for new sessions and silently wrong for every existing one.
 */
export function readAccessTokenCookie(cookies: CookieReader) {
  const current = cookies.get(ACCESS_TOKEN_COOKIE)?.value;

  if (current) {
    return current;
  }

  for (const name of LEGACY_ACCESS_TOKEN_COOKIES) {
    const value = cookies.get(name)?.value;

    if (value) {
      return value;
    }
  }

  return undefined;
}

/** The same, for the refresh token. */
export function readRefreshTokenCookieValue(cookies: CookieReader) {
  const current = cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  if (current) {
    return current;
  }

  for (const name of LEGACY_REFRESH_TOKEN_COOKIES) {
    const value = cookies.get(name)?.value;

    if (value) {
      return value;
    }
  }

  return undefined;
}

/** True when this browser carries a session under any spelling. */
export function hasSessionCookie(cookies: CookieReader) {
  return Boolean(readAccessTokenCookie(cookies) ?? readRefreshTokenCookieValue(cookies));
}
