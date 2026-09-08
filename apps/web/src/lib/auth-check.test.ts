import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshSession } from "@/lib/auth-refresh";
import { checkAuthWithRefresh } from "@/lib/auth-check";

vi.mock("@/lib/auth-refresh", () => ({
  refreshSession: vi.fn(),
}));

const refreshSessionMock = vi.mocked(refreshSession);

function me(user: Record<string, unknown>, status = 200) {
  return new Response(
    JSON.stringify({ data: { user }, message: "ok", success: true }),
    { status },
  );
}

function unauthenticated() {
  return new Response(
    JSON.stringify({ errorCode: "UNAUTHENTICATED", message: "no", success: false }),
    { status: 401 },
  );
}

/**
 * The registration case, from the browser's side.
 *
 * A hostel promotes somebody's PUBLIC account to RESIDENT. The account is right
 * in the database and wrong in this tab's access token, and nothing on the
 * public site 401s or 403s — so without this the tab stays a public tab until
 * the token expires, which is what "they were registered and nothing happened"
 * actually looked like.
 */
describe("checkAuthWithRefresh", () => {
  beforeEach(() => {
    refreshSessionMock.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rotates the token and re-asks when the account outgrew the session", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(me({ role: "PUBLIC", sessionStale: true }))
      .mockResolvedValueOnce(me({ role: "RESIDENT", sessionStale: false }));
    refreshSessionMock.mockResolvedValue(true);

    const response = await checkAuthWithRefresh();
    const payload = (await response.json()) as {
      data: { user: { role: string } };
    };

    // The second answer, not the first: a caller that rendered the stale one
    // would paint the public header over an account that is now a resident.
    expect(payload.data.user.role).toBe("RESIDENT");
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
  });

  it("returns the stale answer rather than nothing when the refresh fails", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(me({ role: "PUBLIC", sessionStale: true }));
    refreshSessionMock.mockResolvedValue(false);

    const response = await checkAuthWithRefresh();

    // Still signed in, just on an old role. Dropping the session here would sign
    // somebody out for the crime of having been registered.
    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves an up-to-date session alone", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(me({ role: "RESIDENT", sessionStale: false }));

    await checkAuthWithRefresh();

    // Refreshing on every /me call would rotate the refresh token constantly,
    // and two tabs racing that rotation is how a session dies.
    expect(refreshSessionMock).not.toHaveBeenCalled();
  });

  it("still refreshes an expired token before anything else", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(me({ role: "RESIDENT", sessionStale: false }));
    refreshSessionMock.mockResolvedValue(true);

    const response = await checkAuthWithRefresh();

    expect(response.ok).toBe(true);
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
  });

  it("does not send an API that has never heard of the flag into a refresh", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response("not json at all", { status: 200 }),
    );

    await checkAuthWithRefresh();

    expect(refreshSessionMock).not.toHaveBeenCalled();
  });
});
