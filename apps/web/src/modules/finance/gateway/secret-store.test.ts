/**
 * Secret store — Block 6 items 6.0 and 6.1 of
 * docs/FINANCE_IMPLEMENTATION_PLAN.md (ADR-6, D5).
 *
 * The behaviour that earns this module its place before the provider
 * integrations is one signature answering correctly for every hostel, every
 * provider and both environments. That is what most of these assert: sandbox
 * credentials for a sandbox entry, the hostel's own decrypted secret for a live
 * one, and — the two that matter — **never a silent fall back to sandbox**,
 * because a live checkout signed with a test key sends a resident's money to the
 * wrong merchant, and **never one provider's key handed to another's adapter**.
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

import { encryptSecret, parseMasterKey } from "@/modules/finance/gateway/envelope-crypto";
import {
  describeSecret,
  getGatewayCredentials,
  isGatewayPayable,
  matchesFingerprint,
  putSecret,
  readSecret,
  resetMasterKeyCache,
  rotateMasterKey,
} from "@/modules/finance/gateway/secret-store";
import { HostelPaymentProfileModel } from "@hostel/db/models/HostelPaymentProfile";

const MASTER = randomBytes(32).toString("base64");
const OTHER_MASTER = randomBytes(32).toString("base64");
const LIVE_SECRET = "esewa_live_9f3c1a7e2b8d4056";

const principal = {
  hostelIds: [hostelId.toString()],
  role: Role.HOSTEL_ADMIN,
  userId: "64f0f0f0f0f0f0f0f0f0f0b1",
} as ApiPrincipal;

const originalEnv = { ...process.env };

function chain<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), select: vi.fn().mockReturnThis() };
}

/** A profile carrying one gateway entry, as the resolver reads it. */
function profileWith(entry: Record<string, unknown>) {
  return chain({
    gateways: [
      { enabledAt: new Date(), merchantCode: "RUPA001", mode: "LIVE", ...entry },
    ],
  });
}

/** The key id `secret-store` derives, so a stored row can claim the right one. */
function keyIdOf(raw: string) {
  return createHash("sha256").update(raw.trim()).digest("hex").slice(0, 12);
}

/** An envelope as `putSecret` would have written it. */
function storedEnvelope(
  plaintext: string,
  master = MASTER,
  scopeHostel = hostelId,
  provider = "ESEWA",
) {
  return {
    ...encryptSecret(
      plaintext,
      {
        hostelId: scopeHostel.toString(),
        purpose: `${provider}:GATEWAY_SECRET`,
      },
      { id: keyIdOf(master), key: parseMasterKey(master) },
    ),
    _id: new Types.ObjectId(),
    hostelId: scopeHostel,
    provider,
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
  vi.spyOn(HostelPaymentProfileModel, "findOne").mockImplementation(
    mocks.profileFindOne,
  );
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetMasterKeyCache();
  vi.restoreAllMocks();
});

describe("sandbox entries", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.profileFindOne.mockReturnValue(
      profileWith({ mode: "SANDBOX", provider: "ESEWA" }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * eSewa's test merchant is published in their own developer documentation and
   * shared by every integrator in the country. Defaulting it is what makes the
   * checkout work on a fresh clone with no setup step.
   */
  it("uses eSewa's published test merchant without any configuration", async () => {
    const credentials = await getGatewayCredentials(hostelId, "ESEWA");

    expect(credentials.merchantCode).toBe("EPAYTEST");
    expect(credentials.secret).toBeTruthy();
  });

  it("prefers an env override over the published default", async () => {
    process.env.ESEWA_SANDBOX_MERCHANT_CODE = "MYTEST";
    process.env.ESEWA_SANDBOX_SECRET = "my-test-secret";

    expect((await getGatewayCredentials(hostelId, "ESEWA")).merchantCode).toBe("MYTEST");
  });

  it("returns the same credentials for every hostel", async () => {
    const first = await getGatewayCredentials(hostelId, "ESEWA");
    const second = await getGatewayCredentials(otherHostelId, "ESEWA");

    expect(first).toEqual(second);
  });

  it("marks them as sandbox, so no screen can claim otherwise", async () => {
    // A resident must never see a live-looking payment screen wired to a test
    // merchant. The flag is what lets the UI say so.
    expect((await getGatewayCredentials(hostelId, "ESEWA")).sandbox).toBe(true);
  });

  it("falls back to the signing secret when no webhook secret is set", async () => {
    process.env.ESEWA_SANDBOX_SECRET = "sandbox-secret";

    expect((await getGatewayCredentials(hostelId, "ESEWA")).webhookSecret).toBe(
      "sandbox-secret",
    );
  });

  it("never reads a stored secret", async () => {
    await getGatewayCredentials(hostelId, "ESEWA");

    expect(mocks.secretFindOne).not.toHaveBeenCalled();
  });

  /**
   * Khalti and Fonepay have no published test merchant — each developer
   * registers their own — so an unset variable is a configuration error rather
   * than something to paper over.
   */
  it("says plainly when a provider without a published sandbox is unconfigured", async () => {
    mocks.profileFindOne.mockReturnValue(
      profileWith({ merchantCode: null, mode: "SANDBOX", provider: "KHALTI" }),
    );

    await expect(getGatewayCredentials(hostelId, "KHALTI")).rejects.toMatchObject({
      errorCode: "GATEWAY_NOT_CONFIGURED",
    });
  });

  it("names the variables an operator has to set", async () => {
    mocks.profileFindOne.mockReturnValue(
      profileWith({ merchantCode: null, mode: "SANDBOX", provider: "KHALTI" }),
    );

    await expect(getGatewayCredentials(hostelId, "KHALTI")).rejects.toThrow(
      /KHALTI_SANDBOX_SECRET/,
    );
  });
});

describe("live entries", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ESEWA_SANDBOX_MERCHANT_CODE = "EPAYTEST";
    process.env.ESEWA_SANDBOX_SECRET = "sandbox-secret";
    mocks.profileFindOne.mockReturnValue(profileWith({ provider: "ESEWA" }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the hostel's own decrypted secret", async () => {
    mocks.secretFindOne.mockReturnValue(chain(storedEnvelope(LIVE_SECRET)));

    const credentials = await getGatewayCredentials(hostelId, "ESEWA");

    expect(credentials.merchantCode).toBe("RUPA001");
    expect(credentials.secret).toBe(LIVE_SECRET);
    expect(credentials.sandbox).toBe(false);
    expect(credentials.provider).toBe("ESEWA");
  });

  it("refuses rather than falling back to sandbox when the key is missing", async () => {
    // The single most dangerous behaviour this module could have: a live
    // checkout signed with a test key sends money to the wrong merchant.
    mocks.secretFindOne.mockReturnValue(chain(null));

    await expect(getGatewayCredentials(hostelId, "ESEWA")).rejects.toMatchObject({
      errorCode: "GATEWAY_NOT_CONFIGURED",
    });
  });

  it("refuses when the gateway was never enabled", async () => {
    mocks.profileFindOne.mockReturnValue(
      profileWith({ enabledAt: null, provider: "ESEWA" }),
    );

    await expect(getGatewayCredentials(hostelId, "ESEWA")).rejects.toMatchObject({
      errorCode: "GATEWAY_NOT_CONFIGURED",
    });
  });

  it("refuses a provider the hostel never configured", async () => {
    await expect(getGatewayCredentials(hostelId, "KHALTI")).rejects.toMatchObject({
      errorCode: "GATEWAY_NOT_CONFIGURED",
    });
  });

  /**
   * A personal wallet caps at NPR 5,000 credited per day. Enabling one is
   * refused at the setup screen; reaching here means it was written some other
   * way, and the resident must still not be sent to it.
   */
  it("refuses a personal account even when it is marked enabled", async () => {
    mocks.profileFindOne.mockReturnValue(
      profileWith({ accountKind: "PERSONAL", provider: "FONEPAY" }),
    );

    await expect(getGatewayCredentials(hostelId, "FONEPAY")).rejects.toMatchObject({
      errorCode: "GATEWAY_NOT_ELIGIBLE",
    });
  });

  it("refuses a sandbox entry in production rather than taking real money to a test merchant", async () => {
    mocks.profileFindOne.mockReturnValue(
      profileWith({ mode: "SANDBOX", provider: "ESEWA" }),
    );

    await expect(getGatewayCredentials(hostelId, "ESEWA")).rejects.toMatchObject({
      errorCode: "GATEWAY_SANDBOX_IN_PRODUCTION",
    });
  });

  it("refuses a secret stored against a different hostel", async () => {
    // Bound by the envelope's associated data, so a row copied between hostels
    // fails to decrypt rather than granting one hostel another's signing key.
    mocks.secretFindOne.mockReturnValue(
      chain(storedEnvelope(LIVE_SECRET, MASTER, otherHostelId)),
    );

    await expect(getGatewayCredentials(hostelId, "ESEWA")).rejects.toThrow();
  });

  /**
   * The property item 6.1 adds: a ciphertext is bound to its provider as well as
   * its hostel. A Khalti key written into the eSewa row fails to authenticate
   * rather than being handed to the eSewa adapter as its signing key.
   */
  it("refuses a secret stored against a different provider", async () => {
    mocks.secretFindOne.mockReturnValue(
      chain(storedEnvelope(LIVE_SECRET, MASTER, hostelId, "KHALTI")),
    );

    await expect(getGatewayCredentials(hostelId, "ESEWA")).rejects.toThrow();
  });

  it("refuses when the master key is missing entirely", async () => {
    delete process.env.FINANCE_MASTER_KEY;
    resetMasterKeyCache();
    mocks.secretFindOne.mockReturnValue(chain(storedEnvelope(LIVE_SECRET)));

    await expect(getGatewayCredentials(hostelId, "ESEWA")).rejects.toThrow(
      /FINANCE_MASTER_KEY/,
    );
  });
});

describe("what residents are offered", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const live = {
    accountKind: "MERCHANT" as const,
    enabledAt: new Date(),
    merchantCode: "RUPA001",
    mode: "LIVE" as const,
    provider: "ESEWA" as const,
  };

  it("offers a live, enabled, eligible entry", () => {
    expect(isGatewayPayable(live)).toBe(true);
  });

  it.each([
    ["nothing configured", null],
    ["never enabled", { ...live, enabledAt: null }],
    ["a personal wallet", { ...live, accountKind: "PERSONAL" as const }],
    ["no merchant code", { ...live, merchantCode: null }],
  ])("does not offer %s", (_label, entry) => {
    expect(isGatewayPayable(entry)).toBe(false);
  });

  /**
   * Hidden rather than shown with a warning. The warning is the weaker control:
   * it relies on the resident reading it before they pay, and money sent to a
   * test merchant is not recoverable by explaining it afterwards.
   */
  it("hides a sandbox entry in production but offers it in development", () => {
    const sandbox = { ...live, mode: "SANDBOX" as const };

    vi.stubEnv("NODE_ENV", "production");
    expect(isGatewayPayable(sandbox)).toBe(false);

    vi.stubEnv("NODE_ENV", "development");
    expect(isGatewayPayable(sandbox)).toBe(true);
  });
});

describe("storing a secret", () => {
  const input = {
    hostelId,
    plaintext: LIVE_SECRET,
    principal,
    provider: "ESEWA" as const,
    purpose: "GATEWAY_SECRET" as const,
  };

  it("writes an envelope and no plaintext", async () => {
    await putSecret(input);

    const written = JSON.stringify(mocks.secretUpdateOne.mock.calls[0]![1]);

    expect(written).not.toContain(LIVE_SECRET);
    expect(mocks.secretUpdateOne.mock.calls[0]![1].$set.ciphertext).toBeTruthy();
  });

  it("keys the row by provider, so one hostel can hold several", async () => {
    await putSecret(input);

    expect(mocks.secretUpdateOne.mock.calls[0]![0]).toEqual({
      hostelId,
      provider: "ESEWA",
      purpose: "GATEWAY_SECRET",
    });
  });

  it("upserts, so a hostel never has two live keys for one provider", async () => {
    await putSecret(input);

    expect(mocks.secretUpdateOne.mock.calls[0]![2]).toEqual({ upsert: true });
  });

  it("audits the change by fingerprint, never by value", async () => {
    const { fingerprint } = await putSecret(input);
    const entry = mocks.audit.mock.calls[0]![1];

    expect(entry.action).toBe("GATEWAY_SECRET_STORED");
    expect(entry.reason).toContain(fingerprint);
    expect(entry.reason).toContain("ESEWA");
    expect(JSON.stringify(entry)).not.toContain(LIVE_SECRET);
  });

  it("records a replacement as a rotation", async () => {
    mocks.secretFindOne.mockReturnValue(chain({ fingerprint: "old" }));

    await putSecret(input);

    expect(mocks.audit.mock.calls[0]![1].action).toBe("GATEWAY_SECRET_ROTATED");
  });

  it("refuses a blank secret", async () => {
    await expect(putSecret({ ...input, plaintext: "   " })).rejects.toMatchObject({
      errorCode: "GATEWAY_NOT_CONFIGURED",
    });
  });

  /**
   * The same plaintext stored for two providers produces two unrelated
   * fingerprints, so neither row confirms the other's key.
   */
  it("scopes the fingerprint to the provider", async () => {
    const esewa = await putSecret(input);
    const khalti = await putSecret({ ...input, provider: "KHALTI" });

    expect(esewa.fingerprint).not.toBe(khalti.fingerprint);
  });
});

describe("what the settings screen may see", () => {
  it("reports that a secret exists, with its fingerprint and dates", async () => {
    mocks.secretFindOne.mockReturnValue(
      chain({ fingerprint: "abc123", rotatedAt: null, updatedAt: new Date() }),
    );

    const described = await describeSecret(hostelId, "ESEWA", "GATEWAY_SECRET");

    expect(described.configured).toBe(true);
    expect(described.fingerprint).toBe("abc123");
  });

  it("reports nothing configured without inventing a fingerprint", async () => {
    expect(await describeSecret(hostelId, "ESEWA", "GATEWAY_SECRET")).toMatchObject({
      configured: false,
      fingerprint: null,
    });
  });

  it("confirms a candidate matches without either side revealing a value", async () => {
    const { fingerprint } = await putSecret({
      hostelId,
      plaintext: LIVE_SECRET,
      principal,
      provider: "ESEWA",
      purpose: "GATEWAY_SECRET",
    });

    expect(
      matchesFingerprint(LIVE_SECRET, fingerprint, hostelId, "ESEWA", "GATEWAY_SECRET"),
    ).toBe(true);
    expect(
      matchesFingerprint("wrong", fingerprint, hostelId, "ESEWA", "GATEWAY_SECRET"),
    ).toBe(false);
    // The right key against the wrong provider is still a mismatch.
    expect(
      matchesFingerprint(LIVE_SECRET, fingerprint, hostelId, "KHALTI", "GATEWAY_SECRET"),
    ).toBe(false);
  });
});

describe("reading a secret", () => {
  it("returns null when the hostel has none", async () => {
    expect(await readSecret(hostelId, "ESEWA", "GATEWAY_SECRET")).toBeNull();
  });

  it("opens a row still wrapped by the outgoing master key", async () => {
    process.env.FINANCE_MASTER_KEY = OTHER_MASTER;
    process.env.FINANCE_MASTER_KEY_PREVIOUS = MASTER;
    resetMasterKeyCache();
    mocks.secretFindOne.mockReturnValue(chain(storedEnvelope(LIVE_SECRET, MASTER)));

    expect(await readSecret(hostelId, "ESEWA", "GATEWAY_SECRET")).toBe(LIVE_SECRET);
  });
});

describe("rotating the master key", () => {
  beforeEach(() => {
    process.env.FINANCE_MASTER_KEY = OTHER_MASTER;
    process.env.FINANCE_MASTER_KEY_PREVIOUS = MASTER;
    resetMasterKeyCache();
  });

  it("rewraps rows held under the outgoing key, leaving ciphertext alone", async () => {
    mocks.secretFind.mockReturnValue(chain([storedEnvelope(LIVE_SECRET, MASTER)]));

    const result = await rotateMasterKey();

    expect(result.rewrapped).toBe(1);
    expect(result.failed).toBe(0);

    const update = mocks.secretUpdateOne.mock.calls[0]![1].$set;

    expect(update.keyId).toBe(keyIdOf(OTHER_MASTER));
    expect(update.ciphertext).toBeUndefined();
  });

  /** Rotation must read each row's provider, or it rewraps under the wrong scope. */
  it("rewraps a row belonging to any provider", async () => {
    mocks.secretFind.mockReturnValue(
      chain([storedEnvelope(LIVE_SECRET, MASTER, hostelId, "KHALTI")]),
    );

    expect((await rotateMasterKey()).rewrapped).toBe(1);
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
