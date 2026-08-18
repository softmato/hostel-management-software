import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  credentialCountDocuments: vi.fn(),
  credentialCreate: vi.fn(),
  credentialExists: vi.fn(),
  credentialFind: vi.fn(),
  credentialFindOne: vi.fn(),
  credentialFindOneAndUpdate: vi.fn(),
  hashPassword: vi.fn(async (value: string) => `hash:${value}`),
  sessionUpdateMany: vi.fn(),
  userFindOne: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@/lib/password", () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
}));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

vi.mock("@hostel/db/models/Session", () => ({
  SessionModel: { updateMany: mocks.sessionUpdateMany },
}));

vi.mock("@hostel/db/models/TemporaryCredential", () => ({
  TemporaryCredentialModel: {
    countDocuments: mocks.credentialCountDocuments,
    create: mocks.credentialCreate,
    exists: mocks.credentialExists,
    find: mocks.credentialFind,
    findOne: mocks.credentialFindOne,
    findOneAndUpdate: mocks.credentialFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { findOne: mocks.userFindOne },
}));

import {
  authenticateTemporaryCredential,
  createTemporaryCredential,
  listTemporaryCredentials,
  MAX_ACTIVE_TEMPORARY_CREDENTIALS,
  revokeTemporaryCredential,
} from "@/modules/auth/temporary-credential.service";

const OWNER_ID = new Types.ObjectId().toString();
const CREDENTIAL_ID = new Types.ObjectId();

function credentialRecord(overrides: Record<string, unknown> = {}) {
  return {
    _id: CREDENTIAL_ID,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    label: "Accountant",
    lastUsedAt: null,
    revokedAt: null,
    useCount: 0,
    userId: new Types.ObjectId(OWNER_ID),
    username: "accountant-oct",
    ...overrides,
  };
}

/** A live mongoose-ish document: has `save`, keeps its mutated fields. */
function credentialDocument(overrides: Record<string, unknown> = {}) {
  return {
    ...credentialRecord(overrides),
    passwordHash: "hash:stored",
    save: vi.fn(),
  };
}

describe("temporary credential service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.credentialCountDocuments.mockResolvedValue(0);
    mocks.credentialExists.mockResolvedValue(null);
  });

  describe("createTemporaryCredential", () => {
    it("returns the password once and persists only its hash", async () => {
      mocks.credentialCreate.mockImplementation(async (data: Record<string, unknown>) => ({
        ...credentialRecord(data),
        toObject: () => credentialRecord(data),
      }));

      const result = await createTemporaryCredential(OWNER_ID, {
        expiresInHours: 24,
        label: "Accountant",
        username: "accountant-oct",
      });

      expect(result.password).toMatch(/^[A-Za-z0-9_-]{20,}$/);

      const stored = mocks.credentialCreate.mock.calls[0][0] as Record<string, unknown>;

      expect(stored.passwordHash).toBe(`hash:${result.password}`);

      // Nothing but `passwordHash` may carry the password — and that field only
      // ever holds what `hashPassword` returned, never the plaintext itself.
      const { passwordHash, ...rest } = stored;

      expect(JSON.stringify(rest)).not.toContain(result.password);
      expect(passwordHash).not.toBe(result.password);
      expect(result.credential.username).toBe("accountant-oct");
      // The serialized row handed back to the caller is password-free too.
      expect(JSON.stringify(result.credential)).not.toContain(result.password);
    });

    it("expires the credential the requested number of hours out", async () => {
      mocks.credentialCreate.mockImplementation(async (data: Record<string, unknown>) => ({
        ...credentialRecord(data),
        toObject: () => credentialRecord(data),
      }));

      const before = Date.now();

      await createTemporaryCredential(OWNER_ID, {
        expiresInHours: 4,
        username: "one-evening",
      });

      const stored = mocks.credentialCreate.mock.calls[0][0] as { expiresAt: Date };
      const offsetMs = stored.expiresAt.getTime() - before;

      expect(offsetMs).toBeGreaterThan(3.9 * 60 * 60 * 1000);
      expect(offsetMs).toBeLessThan(4.1 * 60 * 60 * 1000);
    });

    it("refuses once the active limit is reached", async () => {
      mocks.credentialCountDocuments.mockResolvedValue(MAX_ACTIVE_TEMPORARY_CREDENTIALS);

      await expect(
        createTemporaryCredential(OWNER_ID, {
          expiresInHours: 24,
          username: "one-too-many",
        }),
      ).rejects.toMatchObject({ errorCode: "TEMPORARY_CREDENTIAL_LIMIT", status: 409 });

      expect(mocks.credentialCreate).not.toHaveBeenCalled();
    });

    it("refuses a username another account already holds", async () => {
      mocks.credentialExists.mockResolvedValue({ _id: new Types.ObjectId() });

      await expect(
        createTemporaryCredential(OWNER_ID, {
          expiresInHours: 24,
          username: "accountant-oct",
        }),
      ).rejects.toMatchObject({
        errorCode: "TEMPORARY_CREDENTIAL_USERNAME_TAKEN",
        status: 409,
      });
    });

    it("turns a racing unique-index violation into the same taken-username error", async () => {
      mocks.credentialCreate.mockRejectedValue(Object.assign(new Error("dup"), {
        code: 11000,
      }));

      await expect(
        createTemporaryCredential(OWNER_ID, {
          expiresInHours: 24,
          username: "accountant-oct",
        }),
      ).rejects.toMatchObject({ errorCode: "TEMPORARY_CREDENTIAL_USERNAME_TAKEN" });
    });
  });

  describe("authenticateTemporaryCredential", () => {
    it("resolves to the owning account and stamps the usage counters", async () => {
      const credential = credentialDocument();
      const owner = { _id: OWNER_ID, name: "Owner" };

      mocks.credentialFindOne.mockReturnValue({
        select: vi.fn().mockResolvedValue(credential),
      });
      mocks.verifyPassword.mockResolvedValue(true);
      mocks.userFindOne.mockResolvedValue(owner);

      await expect(
        authenticateTemporaryCredential("accountant-oct", "right-password"),
      ).resolves.toEqual({ credentialId: CREDENTIAL_ID.toString(), owner });

      expect(credential.useCount).toBe(1);
      expect(credential.lastUsedAt).toBeInstanceOf(Date);
      expect(credential.save).toHaveBeenCalled();
    });

    it("only ever looks at credentials that are unexpired and unrevoked", async () => {
      mocks.credentialFindOne.mockReturnValue({
        select: vi.fn().mockResolvedValue(null),
      });

      await authenticateTemporaryCredential("accountant-oct", "whatever");

      expect(mocks.credentialFindOne).toHaveBeenCalledWith({
        expiresAt: { $gt: expect.any(Date) },
        revokedAt: null,
        username: "accountant-oct",
      });
    });

    it("returns null on a wrong password without touching the owner record", async () => {
      mocks.credentialFindOne.mockReturnValue({
        select: vi.fn().mockResolvedValue(credentialDocument()),
      });
      mocks.verifyPassword.mockResolvedValue(false);

      await expect(
        authenticateTemporaryCredential("accountant-oct", "wrong"),
      ).resolves.toBeNull();
      expect(mocks.userFindOne).not.toHaveBeenCalled();
    });

    it("returns null when the owning account is no longer active", async () => {
      const credential = credentialDocument();

      mocks.credentialFindOne.mockReturnValue({
        select: vi.fn().mockResolvedValue(credential),
      });
      mocks.verifyPassword.mockResolvedValue(true);
      // Suspended / deleted owners fall out of the ACTIVE-scoped query.
      mocks.userFindOne.mockResolvedValue(null);

      await expect(
        authenticateTemporaryCredential("accountant-oct", "right-password"),
      ).resolves.toBeNull();
      expect(credential.save).not.toHaveBeenCalled();
    });
  });

  describe("revokeTemporaryCredential", () => {
    it("revokes the credential and every session it opened", async () => {
      mocks.credentialFindOneAndUpdate.mockReturnValue({
        lean: vi.fn().mockResolvedValue(credentialRecord({ revokedAt: new Date() })),
      });

      await revokeTemporaryCredential(OWNER_ID, CREDENTIAL_ID.toString());

      expect(mocks.credentialFindOneAndUpdate).toHaveBeenCalledWith(
        { _id: CREDENTIAL_ID.toString(), revokedAt: null, userId: OWNER_ID },
        { $set: { revokedAt: expect.any(Date) } },
        { new: true },
      );
      expect(mocks.sessionUpdateMany).toHaveBeenCalledWith(
        { revokedAt: null, temporaryCredentialId: CREDENTIAL_ID },
        { $set: { revokedAt: expect.any(Date) } },
      );
    });

    it("answers 404 for a credential belonging to another account", async () => {
      // Scoped by userId, so someone else's id simply does not match.
      mocks.credentialFindOneAndUpdate.mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      });

      await expect(
        revokeTemporaryCredential(OWNER_ID, new Types.ObjectId().toString()),
      ).rejects.toMatchObject({
        errorCode: "TEMPORARY_CREDENTIAL_NOT_FOUND",
        status: 404,
      });
      expect(mocks.sessionUpdateMany).not.toHaveBeenCalled();
    });

    it("rejects a malformed id without querying", async () => {
      await expect(revokeTemporaryCredential(OWNER_ID, "not-an-id")).rejects.toMatchObject(
        { status: 404 },
      );
      expect(mocks.credentialFindOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe("listTemporaryCredentials", () => {
    it("never returns a password hash and labels each row's status", async () => {
      mocks.credentialFind.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue([
              credentialRecord(),
              credentialRecord({
                _id: new Types.ObjectId(),
                expiresAt: new Date("2020-01-01T00:00:00.000Z"),
                username: "last-year",
              }),
              credentialRecord({
                _id: new Types.ObjectId(),
                revokedAt: new Date("2026-08-02T00:00:00.000Z"),
                username: "pulled",
              }),
            ]),
          }),
        }),
      });

      const result = await listTemporaryCredentials(OWNER_ID);

      expect(result.credentials.map((row) => row.status)).toEqual([
        "ACTIVE",
        "EXPIRED",
        "REVOKED",
      ]);
      expect(JSON.stringify(result)).not.toContain("passwordHash");
    });
  });
});
