import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const authMocks = vi.hoisted(() => ({
  isTemporaryCredentialActive: vi.fn(),
  verifyAccessToken: vi.fn(),
}));

vi.mock("@/modules/auth/temporary-credential.service", () => ({
  isTemporaryCredentialActive: authMocks.isTemporaryCredentialActive,
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
  assertPrimaryCredentialPrincipal,
  loadApiPrincipal,
  requirePlatformPrincipal,
} from "@/lib/api-auth";

function bearerRequest() {
  return new NextRequest("https://hostelhub.local/api/v1/protected", {
    headers: { authorization: "Bearer access-token" },
  });
}

describe("api auth guards", () => {
  beforeEach(() => {
    authMocks.verifyAccessToken.mockReset();
    authMocks.isTemporaryCredentialActive.mockReset();
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

  describe("temporary credential sessions", () => {
    beforeEach(() => {
      authMocks.verifyAccessToken.mockResolvedValue({
        hostelIds: ["hostel-1"],
        role: Role.HOSTEL_ADMIN,
        sessionId: "session-1",
        sub: "user-1",
        temporaryCredentialId: "credential-1",
        tokenType: "access",
      });
    });

    it("carries the credential id onto the principal while it is live", async () => {
      authMocks.isTemporaryCredentialActive.mockResolvedValue(true);

      await expect(loadApiPrincipal(bearerRequest())).resolves.toMatchObject({
        temporaryCredentialId: "credential-1",
        userId: "user-1",
      });
    });

    it("refuses a signed token whose credential was revoked", async () => {
      // The access token is still cryptographically valid and unexpired — the
      // revocation has to be checked against the database or it would keep
      // working for the rest of its TTL.
      authMocks.isTemporaryCredentialActive.mockResolvedValue(false);

      await expect(loadApiPrincipal(bearerRequest())).resolves.toBeNull();
    });

    it("does not look up anything for an ordinary session", async () => {
      authMocks.verifyAccessToken.mockResolvedValue({
        hostelIds: ["hostel-1"],
        role: Role.HOSTEL_ADMIN,
        sub: "user-1",
        tokenType: "access",
      });

      await expect(loadApiPrincipal(bearerRequest())).resolves.toMatchObject({
        temporaryCredentialId: undefined,
      });
      expect(authMocks.isTemporaryCredentialActive).not.toHaveBeenCalled();
    });

    it("blocks account-level actions from a borrowed login", () => {
      expect(() =>
        assertPrimaryCredentialPrincipal({
          hostelIds: [],
          role: Role.RESIDENT,
          temporaryCredentialId: "credential-1",
          userId: "user-1",
        }),
      ).toThrow(/your own password/i);

      expect(() =>
        assertPrimaryCredentialPrincipal({
          hostelIds: [],
          role: Role.RESIDENT,
          userId: "user-1",
        }),
      ).not.toThrow();
    });
  });
});
