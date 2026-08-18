import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const serviceMocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  hashPassword: vi.fn(),
  hashToken: vi.fn((token: string) => `hash:${token}`),
  refreshTokenExpiresAt: vi.fn(() => new Date("2030-01-01T00:00:00.000Z")),
  sessionFindOne: vi.fn(),
  sessionInstances: [] as Array<Record<string, unknown>>,
  sessionSave: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionUpdateOne: vi.fn(),
  signAccessToken: vi.fn(),
  signPurposeToken: vi.fn(),
  signRefreshToken: vi.fn(),
  authenticateTemporaryCredential: vi.fn(),
  isTemporaryCredentialActive: vi.fn(),
  jwtVerify: vi.fn(),
  oauthAccountCreate: vi.fn(),
  oauthAccountFindOne: vi.fn(),
  userCreate: vi.fn(),
  userFindOne: vi.fn(),
  userUpdateOne: vi.fn(),
  verifyAccessToken: vi.fn(),
  verifyPassword: vi.fn(),
  verifyPurposeToken: vi.fn(),
  verifyRefreshToken: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  connectToDatabase: serviceMocks.connectToDatabase,
}));

vi.mock("@/lib/password", () => ({
  hashPassword: serviceMocks.hashPassword,
  verifyPassword: serviceMocks.verifyPassword,
}));

vi.mock("@/lib/auth", () => ({
  hashToken: serviceMocks.hashToken,
  refreshTokenExpiresAt: serviceMocks.refreshTokenExpiresAt,
  signAccessToken: serviceMocks.signAccessToken,
  signPurposeToken: serviceMocks.signPurposeToken,
  signRefreshToken: serviceMocks.signRefreshToken,
  verifyAccessToken: serviceMocks.verifyAccessToken,
  verifyPurposeToken: serviceMocks.verifyPurposeToken,
  verifyRefreshToken: serviceMocks.verifyRefreshToken,
}));

vi.mock("@hostel/db/models/Session", () => {
  class MockSessionModel {
    static findOne = serviceMocks.sessionFindOne;
    static updateMany = serviceMocks.sessionUpdateMany;
    static updateOne = serviceMocks.sessionUpdateOne;

    _id = `session-${serviceMocks.sessionInstances.length + 1}`;
    refreshTokenHash: string | undefined;
    save = serviceMocks.sessionSave;

    constructor(data: Record<string, unknown>) {
      Object.assign(this, data);
      serviceMocks.sessionInstances.push(this as unknown as Record<string, unknown>);
    }
  }

  return { SessionModel: MockSessionModel };
});

vi.mock("@hostel/db/models/User", () => ({
  UserModel: {
    create: serviceMocks.userCreate,
    findOne: serviceMocks.userFindOne,
    updateOne: serviceMocks.userUpdateOne,
  },
}));

vi.mock("@hostel/db/models/OAuthAccount", () => ({
  OAuthAccountModel: {
    create: serviceMocks.oauthAccountCreate,
    findOne: serviceMocks.oauthAccountFindOne,
  },
}));

// `createRemoteJWKSet` runs at module load, so it has to answer with something
// before any test does. Nothing reads the key set — `jwtVerify` is the mock the
// tests drive.
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "jwks"),
  jwtVerify: serviceMocks.jwtVerify,
}));

vi.mock("@/modules/auth/temporary-credential.service", () => ({
  authenticateTemporaryCredential: serviceMocks.authenticateTemporaryCredential,
  isTemporaryCredentialActive: serviceMocks.isTemporaryCredentialActive,
}));

import {
  authenticateWithGoogle,
  getCurrentUser,
  login,
  logout,
  refreshAccessToken,
} from "@/modules/auth/auth.service";

function createUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: "user-1",
    email: "owner@example.com",
    emailVerified: true,
    emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    hostelIds: [],
    name: "Platform Owner",
    passwordHash: "password-hash",
    phone: null,
    role: Role.SUPERADMIN,
    save: vi.fn(),
    status: "ACTIVE",
    ...overrides,
  };
}

/**
 * A stand-in for a mongoose document. `authenticateWithGoogle` reads and writes
 * through `.get`/`.set` while `publicUser` reads the plain properties, and a
 * real document is both — a double that is only one of them passes for the
 * wrong reason.
 */
function createUserDoc(overrides: Record<string, unknown> = {}) {
  const doc = createUser(overrides) as Record<string, unknown>;

  doc.get = (key: string) => doc[key];
  doc.set = (key: string, value: unknown) => {
    doc[key] = value;
  };

  return doc;
}

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    _id: "session-1",
    refreshTokenHash: "pending",
    // Declared so a test can assert the service revoked the row in place, the
    // way the real mongoose document would let it.
    revokedAt: null as Date | null,
    save: vi.fn(),
    ...overrides,
  };
}

describe("auth service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.sessionInstances.length = 0;
    serviceMocks.signAccessToken.mockResolvedValue("access-token");
    serviceMocks.signRefreshToken.mockResolvedValue("refresh-token");
  });

  it("logs in a valid user and creates a hashed refresh session", async () => {
    const user = createUser();

    serviceMocks.userFindOne.mockReturnValueOnce({
      select: vi.fn().mockResolvedValue(user),
    });
    serviceMocks.verifyPassword.mockResolvedValue(true);

    await expect(
      login({ identifier: "owner@example.com", password: "ChangeMe123!" }),
    ).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: {
        email: "owner@example.com",
        role: Role.SUPERADMIN,
      },
    });

    const session = serviceMocks.sessionInstances.at(-1);

    expect(session?.refreshTokenHash).toBe("hash:refresh-token");
    expect(serviceMocks.sessionSave).toHaveBeenCalled();
    expect(user.save).toHaveBeenCalled();
  });

  it("blocks login when the email is not verified", async () => {
    const user = createUser({ emailVerified: false, emailVerifiedAt: undefined });

    serviceMocks.userFindOne.mockReturnValueOnce({
      select: vi.fn().mockResolvedValue(user),
    });
    serviceMocks.verifyPassword.mockResolvedValue(true);

    await expect(
      login({ identifier: "owner@example.com", password: "ChangeMe123!" }),
    ).rejects.toMatchObject({
      errorCode: "EMAIL_NOT_VERIFIED",
      status: 403,
    });
  });

  it("rejects a wrong password", async () => {
    serviceMocks.userFindOne.mockReturnValueOnce({
      select: vi.fn().mockResolvedValue(createUser()),
    });
    serviceMocks.verifyPassword.mockResolvedValue(false);

    await expect(
      login({ identifier: "owner@example.com", password: "wrong-password" }),
    ).rejects.toMatchObject({
      errorCode: "INVALID_CREDENTIALS",
    });
  });

  it("rotates refresh tokens when refreshing an access token", async () => {
    const session = createSession({ refreshTokenHash: "hash:old-refresh-token" });

    serviceMocks.verifyRefreshToken.mockResolvedValue({
      role: Role.SUPERADMIN,
      sessionId: "session-1",
      sub: "user-1",
      tokenType: "refresh",
    });
    serviceMocks.sessionFindOne.mockResolvedValue(session);
    serviceMocks.userFindOne.mockResolvedValue(createUser());
    serviceMocks.signAccessToken.mockResolvedValue("next-access-token");
    serviceMocks.signRefreshToken.mockResolvedValue("next-refresh-token");

    await expect(refreshAccessToken("old-refresh-token")).resolves.toMatchObject({
      accessToken: "next-access-token",
      refreshToken: "next-refresh-token",
    });
    expect(session.refreshTokenHash).toBe("hash:next-refresh-token");
    expect(session.save).toHaveBeenCalled();
  });

  it("revokes a refresh session on logout", async () => {
    await logout("refresh-token");

    expect(serviceMocks.sessionUpdateOne).toHaveBeenCalledWith(
      { refreshTokenHash: "hash:refresh-token", revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } },
    );
  });

  describe("temporary access logins", () => {
    it("signs an identifier without an @ into the owner's own account", async () => {
      const owner = createUser();

      serviceMocks.authenticateTemporaryCredential.mockResolvedValue({
        credentialId: "credential-1",
        owner,
      });

      await expect(
        login({ identifier: "accountant-oct", password: "issued-password" }),
      ).resolves.toMatchObject({
        user: {
          // The very point of the feature: same account, same role.
          email: "owner@example.com",
          role: Role.SUPERADMIN,
          viaTemporaryCredential: true,
        },
      });

      // Never touched the users table on this path — the credential resolved it.
      expect(serviceMocks.userFindOne).not.toHaveBeenCalled();

      const session = serviceMocks.sessionInstances.at(-1);

      // Stamped on the session so revoking the credential can reach it, and on
      // the tokens so the API can refuse account-level actions.
      expect(session?.temporaryCredentialId).toBe("credential-1");
      expect(serviceMocks.signAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ temporaryCredentialId: "credential-1" }),
      );
    });

    it("rejects an unknown or expired temporary username as plain bad credentials", async () => {
      serviceMocks.authenticateTemporaryCredential.mockResolvedValue(null);

      await expect(
        login({ identifier: "revoked-login", password: "issued-password" }),
      ).rejects.toMatchObject({ errorCode: "INVALID_CREDENTIALS" });
    });

    it("does not retry a failed email login as a temporary username", async () => {
      serviceMocks.userFindOne.mockReturnValueOnce({
        select: vi.fn().mockResolvedValue(null),
      });

      await expect(
        login({ identifier: "owner@example.com", password: "wrong" }),
      ).rejects.toMatchObject({ errorCode: "INVALID_CREDENTIALS" });

      expect(serviceMocks.authenticateTemporaryCredential).not.toHaveBeenCalled();
    });

    it("marks an ordinary password login as not temporary", async () => {
      serviceMocks.userFindOne.mockReturnValueOnce({
        select: vi.fn().mockResolvedValue(createUser()),
      });
      serviceMocks.verifyPassword.mockResolvedValue(true);

      await expect(
        login({ identifier: "owner@example.com", password: "ChangeMe123!" }),
      ).resolves.toMatchObject({ user: { viaTemporaryCredential: false } });

      expect(serviceMocks.sessionInstances.at(-1)?.temporaryCredentialId).toBeNull();
    });

    it("re-authorises a borrowed session on every refresh", async () => {
      const session = createSession({
        refreshTokenHash: "hash:old-refresh-token",
        temporaryCredentialId: "credential-1",
      });

      serviceMocks.verifyRefreshToken.mockResolvedValue({
        role: Role.SUPERADMIN,
        sessionId: "session-1",
        sub: "user-1",
        tokenType: "refresh",
      });
      serviceMocks.sessionFindOne.mockResolvedValue(session);
      serviceMocks.userFindOne.mockResolvedValue(createUser());
      serviceMocks.isTemporaryCredentialActive.mockResolvedValue(true);

      await expect(refreshAccessToken("old-refresh-token")).resolves.toMatchObject({
        user: { viaTemporaryCredential: true },
      });
      expect(serviceMocks.isTemporaryCredentialActive).toHaveBeenCalledWith(
        "credential-1",
      );
    });

    it("kills the session when the credential behind it was revoked", async () => {
      const session = createSession({
        refreshTokenHash: "hash:old-refresh-token",
        temporaryCredentialId: "credential-1",
      });

      serviceMocks.verifyRefreshToken.mockResolvedValue({
        role: Role.SUPERADMIN,
        sessionId: "session-1",
        sub: "user-1",
        tokenType: "refresh",
      });
      serviceMocks.sessionFindOne.mockResolvedValue(session);
      serviceMocks.userFindOne.mockResolvedValue(createUser());
      serviceMocks.isTemporaryCredentialActive.mockResolvedValue(false);

      await expect(refreshAccessToken("old-refresh-token")).rejects.toMatchObject({
        errorCode: "TEMPORARY_CREDENTIAL_INVALID",
      });
      // Otherwise the holder could keep minting 30-day refresh tokens forever.
      expect(session.revokedAt).toBeInstanceOf(Date);
      expect(serviceMocks.signRefreshToken).not.toHaveBeenCalled();
    });

    it("stops reporting a signed-in user once the credential is revoked", async () => {
      serviceMocks.verifyAccessToken.mockResolvedValue({
        role: Role.SUPERADMIN,
        sub: "user-1",
        temporaryCredentialId: "credential-1",
        tokenType: "access",
      });
      serviceMocks.isTemporaryCredentialActive.mockResolvedValue(false);

      // Otherwise the portal shell keeps rendering for a revoked holder until
      // the access token expires, while every data call under it 401s.
      await expect(getCurrentUser("access-token")).rejects.toMatchObject({
        errorCode: "TEMPORARY_CREDENTIAL_INVALID",
      });
      expect(serviceMocks.userFindOne).not.toHaveBeenCalled();
    });

    it("leaves an ordinary session's refresh free of a credential check", async () => {
      const session = createSession({ refreshTokenHash: "hash:old-refresh-token" });

      serviceMocks.verifyRefreshToken.mockResolvedValue({
        role: Role.SUPERADMIN,
        sessionId: "session-1",
        sub: "user-1",
        tokenType: "refresh",
      });
      serviceMocks.sessionFindOne.mockResolvedValue(session);
      serviceMocks.userFindOne.mockResolvedValue(createUser());

      await expect(refreshAccessToken("old-refresh-token")).resolves.toMatchObject({
        user: { viaTemporaryCredential: false },
      });
      expect(serviceMocks.isTemporaryCredentialActive).not.toHaveBeenCalled();
    });
  });

  describe("google sign-in", () => {
    beforeEach(() => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
      serviceMocks.jwtVerify.mockResolvedValue({
        payload: {
          email: "cook@example.com",
          email_verified: true,
          name: "Hostel Cook",
          sub: "google-subject-1",
        },
      });
      serviceMocks.oauthAccountFindOne.mockResolvedValue(null);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("matches an account that has been invited but never signed in", async () => {
      const cook = createUserDoc({
        email: "cook@example.com",
        mustChangePassword: true,
        role: Role.COOK,
        status: "INVITED",
      });

      serviceMocks.userFindOne.mockResolvedValue(cook);

      await authenticateWithGoogle({ idToken: "id-token" });

      /*
       * Matching only ACTIVE sent an INVITED cook into `UserModel.create` with
       * an email the unique index already holds — a duplicate-key 500, not a
       * signup.
       */
      expect(serviceMocks.userFindOne).toHaveBeenCalledWith(
        expect.objectContaining({ status: { $in: ["ACTIVE", "INVITED"] } }),
      );
      expect(serviceMocks.userCreate).not.toHaveBeenCalled();
      expect(cook.status).toBe("ACTIVE");
    });

    it("leaves the warden-issued password on the account it belongs to", async () => {
      const cook = createUserDoc({
        email: "cook@example.com",
        mustChangePassword: true,
        role: Role.COOK,
        status: "INVITED",
      });

      serviceMocks.userFindOne.mockResolvedValue(cook);

      await authenticateWithGoogle({ idToken: "id-token" });

      /*
       * A kitchen's username and password are issued by its warden and shared
       * by the people who use them, so signing in with Google on the same
       * address must not quietly retire the pair they have written down — and
       * must not revoke the sessions already open on it.
       */
      expect(serviceMocks.userUpdateOne).not.toHaveBeenCalled();
      expect(serviceMocks.sessionUpdateMany).not.toHaveBeenCalled();
      expect(cook.mustChangePassword).toBe(true);
    });
  });
});
