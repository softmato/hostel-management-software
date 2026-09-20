import { describe, expect, it } from "vitest";

import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  hasSessionCookie,
  readAccessTokenCookie,
  readRefreshTokenCookieValue,
} from "@/lib/auth-cookies";

/**
 * The rename from `hostelhub_*` to `hostelpalika_*` is only safe because these
 * readers accept both. If the fallback ever goes, every browser holding a live
 * session is signed out at the next deploy and the symptom — "everyone was
 * logged out once" — is indistinguishable from a token bug.
 */
function store(cookies: Record<string, string>) {
  return {
    get: (name: string) => (name in cookies ? { value: cookies[name] } : undefined),
  };
}

describe("access token cookie", () => {
  it("reads the current name", () => {
    expect(readAccessTokenCookie(store({ [ACCESS_TOKEN_COOKIE]: "new" }))).toBe("new");
  });

  it("falls back to the pre-rename name", () => {
    expect(readAccessTokenCookie(store({ hostelhub_access_token: "old" }))).toBe("old");
  });

  it("prefers the current name when a browser carries both", () => {
    expect(
      readAccessTokenCookie(
        store({ [ACCESS_TOKEN_COOKIE]: "new", hostelhub_access_token: "old" }),
      ),
    ).toBe("new");
  });

  it("is undefined when there is no session", () => {
    expect(readAccessTokenCookie(store({}))).toBeUndefined();
  });
});

describe("refresh token cookie", () => {
  it("reads the current name", () => {
    expect(readRefreshTokenCookieValue(store({ [REFRESH_TOKEN_COOKIE]: "new" }))).toBe("new");
  });

  // Two generations back: the pre-rename cookie at "/", and the
  // pre-proxy-refresh one at "/api" that predates the rename entirely.
  it.each([
    ["hostelhub_refresh", "renamed"],
    ["hostelhub_refresh_token", "pre-proxy"],
  ])("falls back to %s", (name, value) => {
    expect(readRefreshTokenCookieValue(store({ [name]: value }))).toBe(value);
  });

  it("prefers the newer spelling over the older one", () => {
    expect(
      readRefreshTokenCookieValue(
        store({ hostelhub_refresh: "newer", hostelhub_refresh_token: "older" }),
      ),
    ).toBe("newer");
  });
});

describe("hasSessionCookie", () => {
  it.each([
    [{ [ACCESS_TOKEN_COOKIE]: "t" }, true],
    [{ [REFRESH_TOKEN_COOKIE]: "t" }, true],
    [{ hostelhub_access_token: "t" }, true],
    [{ hostelhub_refresh: "t" }, true],
    [{}, false],
    // An empty string is a cleared cookie the browser is still sending, not a
    // session — `clearSessionCookies` writes exactly this.
    [{ [ACCESS_TOKEN_COOKIE]: "" }, false],
  ])("%o -> %s", (cookies, expected) => {
    expect(hasSessionCookie(store(cookies))).toBe(expected);
  });
});
