/**
 * Secret store — Block 6 item 6.0 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (ADR-6, D5).
 *
 * The behaviour that earns this item its place before the provider integration
 * is a single signature answering differently in two environments, so that is
 * what most of these assert: sandbox credentials for every hostel in dev, the
 * hostel's own decrypted secret in production, and — the one that matters —
 * **never a silent fall back to sandbox in production**, because a live QR
 * signed with a test key sends a resident's money to the wrong merchant.
 */
import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiPrincipal } from "@/lib/api-auth";
import { Role } from "@/lib/roles";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const otherHostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a2");

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  profileFindOne: vi.fn(),
  secretFind: vi.fn(),
  secretFindOne: vi.fn(),
  secretUpdateOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/modules/finance/audit-finance", () => ({ auditFinanceAction: mocks.audit }));
vi.mock("@hostel/db/models/EncryptedSecret", () => ({
  EncryptedSecretModel: {
    find: mocks.secretFind,
    findOne: mocks.secretFindOne,
    updateOne: mocks.secretUpdateOne,
  },
}));
vi.mock("@hostel/db/models/HostelPaymentProfile", () => ({
  HostelPaymentProfileModel: { findOne: mocks.profileFindOne },
}));

import { encryptSecret, parseMasterKey } from "@/modules/finance/gateway/envelope-crypto";
import {
  describeSecret,
  getGatewayCredentials,
  matchesFingerprint,
  putSecret,
  readSecret,
  resetMasterKeyCache,
  rotateMasterKey,
} from "@/modules/finance/gateway/secret-store";

const MASTER = randomBytes(32).toString("base64");
const OTHER_MASTER = randomBytes(32).toString("base64");
const LIVE_SECRET = "fp_live_9f3c1a7e2b8d4056";

const principal = {
  hostelIds: [hostelId.toString()],
  role: Role.HOSTEL_ADMIN,
  userId: "64f0f0f0f0f0f0f0f0f0f0b1",
} as ApiPrincipal;

const originalEnv = { ...process.env };

function chain<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), select: vi.fn().mockReturnThis() };
}

/** The key id `secret-store` derives, so a stored row can claim the right one. */
function keyIdOf(raw: string) {
  return createHash("sha256").update(raw.trim()).digest("hex").slice(0, 12);
}

/** An envelope as `putSecret` would have written it. */
function storedEnvelope(plaintext: string, master = MASTER, scopeHostel = hostelId) {
  return {
    ...encryptSecret(
      plaintext,
      { hostelId: scopeHostel.toString(), purpose: "GATEWAY_SECRET" },
      { id: keyIdOf(master), key: parseMasterKey(master) },
    ),
    _id: new Types.ObjectId(),
    hostelId: scopeHostel,
    purpose: "GATEWAY_SECRET" as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMasterKeyCache();
  process.env.FINANCE_MASTER_KEY = MASTER;
  delete process.env.FINANCE_MASTER_KEY_PREVIOUS;
  mocks.secretUpdateOne.mockResolvedValue({});
  mocks.secretFindOne.mockReturnValue(chain(null));
  mocks.audit.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetMasterKeyCache();
});

describe("sandbox mode", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.FONEPAY_SANDBOX_MERCHANT_CODE = "TESTMERCHANT";
    process.env.FONEPAY_SANDBOX_SECRET = "sandbox-secret";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the same credentials for every hostel", async () => {
    const first = await getGatewayCredentials(hostelId);
    const second = await getGatewayCredentials(otherHostelId);

    expect(first).toEqual(second);
    expect(first.merchantCode).toBe("TESTMERCHANT");
  });

  it("marks them as sandbox, so no screen can claim otherwise", async () => {
    // A resident must never see a live-looking payment screen wired to a test
    // merchant. The flag is what lets the UI say so.
    expect((await getGatewayCredentials(hostelId)).sandbox).toBe(true);
  });

  it("falls back to the signing secret when no webhook secret is set", async () => {
    expect((await getGatewayCredentials(hostelId)).webhookSecret).toBe(
      "sandbox-secret",
    );
  });

  it("never reads the database", async () => {
    await getGatewayCredentials(hostelId);

    expect(mocks.secretFindOne).not.toHaveBeenCalled();
  });

  it("says plainly when the sandbox is not configured", async () => {
    delete process.env.FONEPAY_SANDBOX_SECRET;

    await expect(getGatewayCredentials(hostelId)).rejects.toMatchObject({
      errorCode: "GATEWAY_NOT_CONFIGURED",
    });
  });
});

describe("production mode", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.FONEPAY_SANDBOX_MERCHANT_CODE = "TESTMERCHANT";
    process.env.FONEPAY_SANDBOX_SECRET = "sandbox-secret";
    mocks.profileFindOne.mockReturnValue(
      chain({
        gatewayEnabledAt: new Date(),
        gatewayMerchantCode: "RUPA001",
        gatewayProvider: "FONEPAY",
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the hostel's own decrypted secret", async () => {
    mocks.secretFindOne.mockReturnValue(chain(storedEnvelope(LIVE_SECRET)));

    const credentials = await getGatewayCredentials(hostelId);

    expect(credentials.merchantCode).toBe("RUPA001");
    expect(credentials.secret).toBe(LIVE_SECRET);
    expect(credentials.sandbox).toBe(false);
  });

  it("refuses rather than falling back to sandbox when the key is missing", async () => {
    // The single most dangerous behaviour this module could have: a live QR
    // signed with a test key sends a resident's money to the wrong merchant.
    mocks.secretFindOne.mockReturnValue(chain(null));

    await expect(getGatewayCredentials(hostelId)).rejects.toMatchObject({
      errorCode: "GATEWAY_NOT_CONFIGURED",
    });
  });

  it("refuses when the gateway was never enabled", async () => {
    mocks.profileFindOne.mockReturnValue(
      chain({ gatewayMerchantCode: "RUPA001", gatewayProvider: "FONEPAY" }),
    );

    await expect(getGatewayCredentials(hostelId)).rejects.toMatchObject({
      errorCode: "GATEWAY_NOT_CONFIGURED",
    });
  });

  it("refuses a secret stored against a different hostel", async () => {
    // Bound by the envelope's associated data, so a row copied between hostels
    // fails to decrypt rather than granting one hostel another's signing key.
    mocks.secretFindOne.mockReturnValue(
      chain(storedEnvelope(LIVE_SECRET, MASTER, otherHostelId)),
    );

    await expect(getGatewayCredentials(hostelId)).rejects.toThrow();
  });

  it("refuses when the master key is missing entirely", async () => {
    delete process.env.FINANCE_MASTER_KEY;
    resetMasterKeyCache();
    mocks.secretFindOne.mockReturnValue(chain(storedEnvelope(LIVE_SECRET)));

    await expect(getGatewayCredentials(hostelId)).rejects.toThrow(/FINANCE_MASTER_KEY/);
  });
});

describe("storing a secret", () => {
  it("writes an envelope and no plaintext", async () => {
    await putSecret({
      hostelId,
      plaintext: LIVE_SECRET,
      principal,
      purpose: "GATEWAY_SECRET",
    });

    const written = JSON.stringify(mocks.secretUpdateOne.mock.calls[0]![1]);

    expect(written).not.toContain(LIVE_SECRET);
    expect(mocks.secretUpdateOne.mock.calls[0]![1].$set.ciphertext).toBeTruthy();
  });

  it("upserts, so a hostel never has two live signing keys", async () => {
    await putSecret({
      hostelId,
      plaintext: LIVE_SECRET,
      principal,
      purpose: "GATEWAY_SECRET",
    });

    expect(mocks.secretUpdateOne.mock.calls[0]![2]).toEqual({ upsert: true });
  });

  it("audits the change by fingerprint, never by value", async () => {
    const { fingerprint } = await putSecret({
      hostelId,
      plaintext: LIVE_SECRET,
      principal,
      purpose: "GATEWAY_SECRET",
    });

    const entry = mocks.audit.mock.calls[0]![1];

    expect(entry.action).toBe("GATEWAY_SECRET_STORED");
    expect(entry.reason).toContain(fingerprint);
    expect(JSON.stringify(entry)).not.toContain(LIVE_SECRET);
  });

  it("records a replacement as a rotation", async () => {
    mocks.secretFindOne.mockReturnValue(chain({ fingerprint: "old" }));

    await putSecret({
      hostelId,
      plaintext: LIVE_SECRET,
      principal,
      purpose: "GATEWAY_SECRET",
    });

    expect(mocks.audit.mock.calls[0]![1].action).toBe("GATEWAY_SECRET_ROTATED");
  });

  it("refuses a blank secret", async () => {
    await expect(
      putSecret({ hostelId, plaintext: "   ", principal, purpose: "GATEWAY_SECRET" }),
    ).rejects.toMatchObject({ errorCode: "GATEWAY_NOT_CONFIGURED" });
  });
});

describe("what the settings screen may see", () => {
  it("reports that a secret exists, with its fingerprint and dates", async () => {
    mocks.secretFindOne.mockReturnValue(
      chain({ fingerprint: "abc123", rotatedAt: null, updatedAt: new Date() }),
    );

    const described = await describeSecret(hostelId, "GATEWAY_SECRET");

    expect(described.configured).toBe(true);
    expect(described.fingerprint).toBe("abc123");
  });

  it("reports nothing configured without inventing a fingerprint", async () => {
    expect(await describeSecret(hostelId, "GATEWAY_SECRET")).toMatchObject({
      configured: false,
      fingerprint: null,
    });
  });

  it("confirms a candidate matches without either side revealing a value", async () => {
    const { fingerprint } = await putSecret({
      hostelId,
      plaintext: LIVE_SECRET,
      principal,
      purpose: "GATEWAY_SECRET",
    });

    expect(matchesFingerprint(LIVE_SECRET, fingerprint, hostelId, "GATEWAY_SECRET")).toBe(
      true,
    );
    expect(matchesFingerprint("wrong", fingerprint, hostelId, "GATEWAY_SECRET")).toBe(
      false,
    );
  });
});

describe("reading a secret", () => {
  it("returns null when the hostel has none", async () => {
    expect(await readSecret(hostelId, "GATEWAY_SECRET")).toBeNull();
  });

  it("opens a row still wrapped by the outgoing master key", async () => {
    process.env.FINANCE_MASTER_KEY = OTHER_MASTER;
    process.env.FINANCE_MASTER_KEY_PREVIOUS = MASTER;
    resetMasterKeyCache();
    mocks.secretFindOne.mockReturnValue(chain(storedEnvelope(LIVE_SECRET, MASTER)));

    expect(await readSecret(hostelId, "GATEWAY_SECRET")).toBe(LIVE_SECRET);
  });
});

describe("rotating the master key", () => {
  beforeEach(() => {
    process.env.FINANCE_MASTER_KEY = OTHER_MASTER;
    process.env.FINANCE_MASTER_KEY_PREVIOUS = MASTER;
    resetMasterKeyCache();
  });

  it("rewraps rows held under the outgoing key, leaving ciphertext alone", async () => {
    const row = storedEnvelope(LIVE_SECRET, MASTER);

    mocks.secretFind.mockReturnValue(chain([row]));

    const result = await rotateMasterKey();

    expect(result.rewrapped).toBe(1);
    expect(result.failed).toBe(0);

    const update = mocks.secretUpdateOne.mock.calls[0]![1].$set;

    expect(update.keyId).toBe(keyIdOf(OTHER_MASTER));
    expect(update.ciphertext).toBeUndefined();
  });

  it("only looks at rows not already on the current key", async () => {
    mocks.secretFind.mockReturnValue(chain([]));

    await rotateMasterKey();

    expect(mocks.secretFind.mock.calls[0]![0]).toEqual({
      keyId: { $ne: keyIdOf(OTHER_MASTER) },
    });
  });

  it("counts a row no configured key can open, and never deletes it", async () => {
    // Unreadable is not gone: an operator who finds the missing key can still
    // recover the secret.
    const orphan = storedEnvelope(LIVE_SECRET, randomBytes(32).toString("base64"));

    mocks.secretFind.mockReturnValue(chain([orphan]));

    const result = await rotateMasterKey();

    expect(result.failed).toBe(1);
    expect(mocks.secretUpdateOne).not.toHaveBeenCalled();
  });
});
