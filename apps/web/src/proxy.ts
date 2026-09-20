import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  hasSessionCookie,
  readAccessTokenCookie,
  readRefreshTokenCookieValue,
} from "@/lib/auth-cookies";
import { applySessionCookies } from "@/lib/session-cookies";
import { isAuthBypassEnabled } from "@/lib/auth-bypass";
import { landingPathForRole, protectedRouteRuleForPath } from "@/lib/route-access";
import { Role } from "@/lib/roles";

/* ── Route aliases (merged from old middleware.ts) ── */
const routeAliases: Record<string, string> = {
  "/signin": "/login",
  "/log-in": "/login",
  "/sign-up": "/signup",
  "/register": "/signup",
  "/term": "/terms",
  "/tnc": "/terms",
  "/privacy-policy": "/privacy",
  "/data-policy": "/privacy",
  "/hostel": "/hostels",
  /*
   * `/pricing` was the first pricing page — three cards of free text from a
   * `pricing` config section, with no service identity behind them, so nothing
   * on it could be linked to, compared across tiers or given a detail page.
   * `/plans-pricing` replaced it and that section is gone, so the old path is
   * an alias rather than a second page quietly showing older prices.
   */
  "/pricing": "/plans-pricing",
  "/pricings": "/plans-pricing",
  "/faq": "/plans-pricing",
};

function accessSecret() {
  const secret = process.env.JWT_ACCESS_SECRET;

  if (!secret) {
    throw new Error("JWT_ACCESS_SECRET is required for protected routes.");
  }

  return new TextEncoder().encode(secret);
}

function redirectToLogin(request: NextRequest, error?: string) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  if (error) {
    loginUrl.searchParams.set("error", error);
  }

  return NextResponse.redirect(loginUrl);
}

function redirectHome(request: NextRequest) {
  const homeUrl = request.nextUrl.clone();
  homeUrl.pathname = "/";
  homeUrl.search = "";

  return NextResponse.redirect(homeUrl);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /* 1. Route alias redirects */
  const aliasTarget = routeAliases[pathname];

  if (aliasTarget) {
    const url = request.nextUrl.clone();
    url.pathname = aliasTarget;
    return NextResponse.redirect(url, { status: 308 });
  }

  /* 2. Skip auth in development / UI-preview mode (never in production) */
  if (isAuthBypassEnabled()) {
    return NextResponse.next();
  }

  /* 3. Auth guard for protected routes */
  const rule = protectedRouteRuleForPath(pathname);

  if (!rule) {
    return isSoftSessionPath(pathname) ? keepSessionAlive(request) : NextResponse.next();
  }

  const refuse = (error?: string) =>
    rule.refuseTo === "home" ? redirectHome(request) : redirectToLogin(request, error);

  let role = await roleFromAccessToken(readAccessTokenCookie(request.cookies));
  let refreshed: { accessToken: string; refreshToken: string | null } | null = null;

  /*
   * The access cookie dies with its 15-minute token, and a page load never goes
   * through the client's 401 → refresh path. Refresh here, from the refresh
   * cookie, so an idle tab or a fresh navigation keeps the session.
   */
  if (!role) {
    refreshed = await refreshFromCookie(request);
    role = refreshed ? await roleFromAccessToken(refreshed.accessToken) : null;
  }

  if (!role) {
    return hasSessionCookie(request.cookies) ? refuse("session_expired") : refuse();
  }

  const withSession = (response: NextResponse) =>
    refreshed ? applySessionCookies(response, refreshed) : response;

  // `roles: null` means the route only asks that somebody is signed in, which
  // the valid token above has already established.
  if (!rule.roles || rule.roles.includes(role)) {
    if (!refreshed) {
      return NextResponse.next();
    }

    // Hand the new token to this same request too, so server components that
    // read the access cookie don't render signed-out.
    request.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.accessToken);

    return withSession(NextResponse.next({ request: { headers: request.headers } }));
  }

  if (rule.refuseTo === "home") {
    return withSession(redirectHome(request));
  }

  const landingPath = landingPathForRole(role);

  if (landingPath) {
    const landingUrl = request.nextUrl.clone();
    landingUrl.pathname = landingPath;
    landingUrl.search = "";

    return withSession(NextResponse.redirect(landingUrl));
  }

  return withSession(redirectToLogin(request, "forbidden"));
}

/**
 * Every page and API call renews a dead session before it is handled, so no
 * request is ever answered signed-out for someone who is signed in. The access
 * cookie dies with its 15-minute token, and optional-auth reads (the community,
 * `/auth/me` in the header) never 401 — without this they would render
 * "Sign in" first and only recover after a client refresh.
 *
 * The auth routes that manage tokens themselves are left alone: refreshing in
 * front of `/auth/refresh` or `/auth/logout` would rotate the token they are
 * about to act on.
 */
function isSoftSessionPath(pathname: string) {
  return !pathname.startsWith("/api/v1/auth/") || pathname === "/api/v1/auth/me";
}

async function keepSessionAlive(request: NextRequest) {
  if (
    !readRefreshTokenCookieValue(request.cookies) ||
    (await roleFromAccessToken(readAccessTokenCookie(request.cookies)))
  ) {
    return NextResponse.next();
  }

  const refreshed = await refreshFromCookie(request);

  if (!refreshed) {
    return NextResponse.next();
  }

  request.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.accessToken);

  return applySessionCookies(
    NextResponse.next({ request: { headers: request.headers } }),
    refreshed,
  );
}

async function roleFromAccessToken(token: string | undefined) {
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, accessSecret());

    return payload.tokenType === "access" &&
      payload.sub &&
      typeof payload.role === "string"
      ? (payload.role as Role)
      : null;
  } catch {
    return null;
  }
}

async function refreshFromCookie(request: NextRequest) {
  const refreshToken = readRefreshTokenCookieValue(request.cookies);

  if (!refreshToken) {
    return null;
  }

  try {
    // Loaded only when a refresh is actually needed, keeping the database out
    // of every signed-in navigation.
    const { refreshAccessToken } = await import("@/modules/auth/auth.service");

    return await refreshAccessToken(refreshToken, { allowRecentReuse: true });
  } catch {
    return null;
  }
}

export const config = {
  matcher: [
    /*
     * Everything but static files, so a dead session is renewed on the very
     * first request — see isSoftSessionPath. Protected portals and the route
     * aliases below are covered by this too; they stay listed as the record of
     * what the proxy guards.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|map|txt|xml|woff2?|webmanifest)$).*)",
    /* Protected portals */
    "/platform/:path*",
    "/hostel-admin/:path*",
    /* Tenant-scoped hostel workspace: /{hostel-slug}/admin/... */
    "/:hostelSlug/admin/:path*",
    "/resident/:path*",
    "/guardian/:path*",
    /*
     * The field team's desk. Its rule sat in `route-access.ts` without an entry
     * here, so the proxy never ran and any visitor rendered the portal.
     */
    "/team",
    "/team/:path*",
    /* The service provider's assigned-jobs list. */
    "/jobs/:path*",
    "/jobs",
    /* Route aliases */
    "/signin",
    "/log-in",
    "/sign-up",
    "/register",
    "/term",
    "/tnc",
    "/privacy-policy",
    "/data-policy",
    "/hostel",
    "/pricings",
    "/faq",
  ],
};
