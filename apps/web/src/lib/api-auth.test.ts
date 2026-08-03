import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const authMocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  ACCESS_TOKEN_COOKIE: "hostelhub_access_token",
  getBearerToken: (authorizationHeader: string | null) =>
    authorizationHeader?.startsWith("Bearer ")
      ? authorizationHeader.slice("Bearer ".length).trim()
      : null,
  verifyAccessToken: authMocks.verifyAccessToken,
}));

import {
  assertHostelScopedApiAccess,
  loadApiPrincipal,
  requirePlatformPrincipal,
} from "@/lib/api-auth";

describe("api auth guards", () => {
  beforeEach(() => {
    authMocks.verifyAccessToken.mockReset();
  });

  it("loads a principal from a bearer access token", async () => {
    authMocks.verifyAccessToken.mockResolvedValue({
      hostelIds: ["hostel-1"],
      role: Role.HOSTEL_ADMIN,
      sessionId: "session-1",
      sub: "user-1",
      tokenType: "access",
    });

    const request = new NextRequest("https://hostelhub.local/api/v1/protected", {
      headers: {
        authorization: "Bearer access-token",
      },
    });

    await expect(loadApiPrincipal(request)).resolves.toEqual({
      hostelIds: ["hostel-1"],
      role: Role.HOSTEL_ADMIN,
      sessionId: "session-1",
      userId: "user-1",
    });
  });

  it("rejects non-platform roles from platform-only API guards", async () => {
    authMocks.verifyAccessToken.mockResolvedValue({
      hostelIds: ["hostel-1"],
      role: Role.HOSTEL_ADMIN,
      sub: "user-1",
      tokenType: "access",
    });

    const request = new NextRequest("https://hostelhub.local/api/v1/platform", {
      headers: {
        authorization: "Bearer access-token",
      },
    });

    await expect(requirePlatformPrincipal(request)).rejects.toMatchObject({
      errorCode: "FORBIDDEN",
      status: 403,
    });
  });

  it("enforces hostel-scoped tenant access", () => {
    expect(() =>
      assertHostelScopedApiAccess(
        {
          hostelIds: ["hostel-1"],
          role: Role.HOSTEL_ADMIN,
          userId: "user-1",
        },
        "hostel-1",
      ),
    ).not.toThrow();

    // 404 with a bare "Not found." — a 403 would confirm hostel-2 exists
    // (RULES.md §3).
    expect(() =>
      assertHostelScopedApiAccess(
        {
          hostelIds: ["hostel-1"],
          role: Role.HOSTEL_ADMIN,
          userId: "user-1",
        },
        "hostel-2",
      ),
    ).toThrow("Not found.");

    try {
      assertHostelScopedApiAccess(
        { hostelIds: ["hostel-1"], role: Role.HOSTEL_ADMIN, userId: "user-1" },
        "hostel-2",
      );
      expect.unreachable("cross-tenant access must throw");
    } catch (error) {
      expect(error).toMatchObject({ errorCode: "NOT_FOUND", status: 404 });
    }
  });
});
