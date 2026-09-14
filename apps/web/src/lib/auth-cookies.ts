export const ACCESS_TOKEN_COOKIE = "hostelhub_access_token";
/*
 * Path "/" so the proxy can see it and refresh an expired access token before a
 * page load, instead of bouncing a signed-in user to /login every 15 minutes.
 * It is a new name rather than the old one at a new path: two same-named
 * cookies at "/" and "/api" would both reach /api/v1/auth/refresh and the stale
 * one could be read first.
 */
export const REFRESH_TOKEN_COOKIE = "hostelhub_refresh";
/** The pre-proxy-refresh cookie, scoped to "/api". Read as a fallback, cleared on sight. */
export const LEGACY_REFRESH_TOKEN_COOKIE = "hostelhub_refresh_token";
