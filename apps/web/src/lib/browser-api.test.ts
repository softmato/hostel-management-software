import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserApi, resetRoleHealForTests } from "@/lib/browser-api";
import { refreshSession } from "@/lib/auth-refresh";

vi.mock("@/lib/auth-refresh", () => ({
  refreshSession: vi.fn(),
}));

const refreshSessionMock = vi.mocked(refreshSession);

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function ok(data: unknown) {
  return jsonResponse(200, { data, message: "ok", success: true });
}

function forbidden() {
  return jsonResponse(403, {
    errorCode: "FORBIDDEN",
    message: "This role is not allowed to perform this action.",
    success: false,
  });
}

describe("browserApi role healing", () => {
  beforeEach(() => {
    resetRoleHealForTests();
    refreshSessionMock.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes and replays once when a role change left the token stale", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(forbidden()).mockResolvedValueOnce(ok({ id: "r1" }));
    refreshSessionMock.mockResolvedValue(true);

    await expect(browserApi("/api/v1/resident/dashboard")).resolves.toEqual({
      id: "r1",
    });
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces the 403 when the refresh does not change the role", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(forbidden()).mockResolvedValueOnce(forbidden());
    refreshSessionMock.mockResolvedValue(true);

    await expect(browserApi("/api/v1/resident/dashboard")).rejects.toThrow(
      "This role is not allowed to perform this action.",
    );
  });

  it("does not refresh again for a user who is genuinely forbidden", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(forbidden());
    refreshSessionMock.mockResolvedValue(false);

    await expect(browserApi("/api/v1/resident/dashboard")).rejects.toThrow();
    await expect(browserApi("/api/v1/resident/payments")).rejects.toThrow();

    // One heal per page load, no matter how many forbidden calls follow.
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
  });

  it("heals every panel when a dashboard fires its requests in parallel", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(forbidden())
      .mockResolvedValueOnce(forbidden())
      .mockResolvedValueOnce(ok({ panel: "a" }))
      .mockResolvedValueOnce(ok({ panel: "b" }));
    refreshSessionMock.mockResolvedValue(true);

    const [a, b] = await Promise.all([
      browserApi("/api/v1/resident/dashboard"),
      browserApi("/api/v1/resident/profile"),
    ]);

    expect([a, b]).toEqual([{ panel: "a" }, { panel: "b" }]);
  });

  it("leaves auth endpoints alone", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(forbidden());

    await expect(browserApi("/api/v1/auth/me")).rejects.toThrow();
    expect(refreshSessionMock).not.toHaveBeenCalled();
  });
});
