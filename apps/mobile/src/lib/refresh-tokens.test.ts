import { describe, expect, it } from "vitest";

import { readRefreshOutcome } from "@/lib/refresh-tokens";

/**
 * The bug this guards against shipped once and cost every session.
 *
 * `/auth/refresh` rotates: the server signs a new refresh token, overwrites
 * `session.refreshTokenHash` with its hash, and returns the new one in the body
 * for mobile clients. The interceptor originally read only `accessToken`, so the
 * dead token stayed in SecureStore — the first refresh worked, the next one
 * 401ed, and the user was signed out roughly half an hour into every session
 * with nothing on screen to explain it.
 *
 * So the first test below is the regression: a rotated token in the response has
 * to come back out to be persisted.
 */
describe("readRefreshOutcome", () => {
  it("returns the rotated refresh token so it can be persisted", () => {
    const outcome = readRefreshOutcome({
      data: { accessToken: "access-2", refreshToken: "refresh-2" },
    });

    expect(outcome).toEqual({
      accessToken: "access-2",
      ok: true,
      refreshToken: "refresh-2",
    });
  });

  it("reports no rotation rather than clearing the stored token", () => {
    // A deployment that answered from the cookie branch, or one older than the
    // mobile-client header, sends only the access token — and in that case the
    // refresh token already on disk is still live. Clearing it would turn a
    // version skew into a forced logout.
    const outcome = readRefreshOutcome({ data: { accessToken: "access-2" } });

    expect(outcome).toEqual({
      accessToken: "access-2",
      ok: true,
      refreshToken: null,
    });
  });

  it("treats a blank rotated token as absent", () => {
    const outcome = readRefreshOutcome({
      data: { accessToken: "access-2", refreshToken: "   " },
    });

    expect(outcome).toEqual({
      accessToken: "access-2",
      ok: true,
      refreshToken: null,
    });
  });

  it("fails when there is no access token to retry with", () => {
    // Replaying the original request with the same dead bearer would loop, so a
    // malformed body has to fall through to the session-ended path instead.
    expect(readRefreshOutcome({ data: { refreshToken: "refresh-2" } })).toEqual({
      ok: false,
    });
    expect(readRefreshOutcome({ data: { accessToken: "" } })).toEqual({ ok: false });
    expect(readRefreshOutcome({ data: null })).toEqual({ ok: false });
    expect(readRefreshOutcome(null)).toEqual({ ok: false });
  });

  it("ignores a non-string token rather than persisting it", () => {
    expect(readRefreshOutcome({ data: { accessToken: 42 } })).toEqual({ ok: false });
    expect(
      readRefreshOutcome({ data: { accessToken: "access-2", refreshToken: 42 } }),
    ).toEqual({ accessToken: "access-2", ok: true, refreshToken: null });
  });
});
