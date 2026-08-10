import { createHash } from "node:crypto";

import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { auditFinanceAction } from "@/modules/finance/audit-finance";
import { FinanceServiceError } from "@/modules/finance/finance.errors";
import {
  type MasterKey,
  type SecretEnvelope,
  type SecretScope,
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  parseMasterKey,
  rewrapSecret,
  SecretCryptoError,
} from "@/modules/finance/gateway/envelope-crypto";
import type { GatewayCredentials } from "@/modules/finance/gateway/provider.types";
import { EncryptedSecretModel } from "@hostel/db/models/EncryptedSecret";
import { HostelPaymentProfileModel } from "@hostel/db/models/HostelPaymentProfile";

/**
 * Where gateway credentials come from (ADR-6, plan item 6.0).
 *
 * One function is the point of this module — {@link getGatewayCredentials} —
 * and it answers differently in development and production **behind an
 * unchanged signature**. Outside production it returns the single set of sandbox
 * credentials from the environment for every hostel; in production it returns
 * that hostel's own decrypted secret. Every caller written during 6.1–6.5 is
 * therefore already correct for real per-hostel credentials, and switching over
 * is a change of *where the secret comes from*, not of any calling code.
 *
 * That is the entire reason this item exists before the provider integration
 * that needs it: build the seam first, or every call site acquires a sandbox
 * assumption that has to be found and removed later.
 *
 * **Nothing here returns a secret to a client.** `describeSecret` is what the
 * settings screen reads — a fingerprint and a date, never the value. A secret
 * that has been written can only be replaced, never displayed.
 */

const SANDBOX_ENV = {
  merchantCode: "FONEPAY_SANDBOX_MERCHANT_CODE",
  secret: "FONEPAY_SANDBOX_SECRET",
  webhookSecret: "FONEPAY_SANDBOX_WEBHOOK_SECRET",
} as const;

export type SecretPurpose = "GATEWAY_SECRET" | "GATEWAY_WEBHOOK_SECRET";

/** Test seam. Cleared whenever the environment is changed under a test. */
let cachedKeys: MasterKey[] | null = null;

export function resetMasterKeyCache(): void {
  cachedKeys = null;
}

/**
 * The master keys, current first.
 *
 * `FINANCE_MASTER_KEY_PREVIOUS` is accepted so a rotation can run with both keys
 * live: existing rows still open under the outgoing key while
 * {@link rotateMasterKey} moves them across. Without it, rotation is a flag day,
 * and a flag day for the key protecting payment secrets is a rotation that never
 * happens.
 */
function masterKeys(): MasterKey[] {
  if (cachedKeys) {
    return cachedKeys;
  }

  const current = process.env.FINANCE_MASTER_KEY;

  if (!current) {
    throw new SecretCryptoError(
      "FINANCE_MASTER_KEY is required to store or read gateway credentials. " +
        "Generate one with: openssl rand -base64 32",
    );
  }

  const keys: MasterKey[] = [{ id: keyIdFor(current), key: parseMasterKey(current) }];
  const previous = process.env.FINANCE_MASTER_KEY_PREVIOUS;

  if (previous) {
    keys.push({ id: keyIdFor(previous), key: parseMasterKey(previous) });
  }

  cachedKeys = keys;

  return keys;
}

/**
 * A short, stable label for a key, derived from the key itself.
 *
 * Derived rather than configured so an operator cannot rotate the key while
 * leaving the id unchanged — which would make every row claim to be wrapped by
 * a key that no longer exists, and turn rotation into silent data loss. It is a
 * truncated digest of a 32-byte random key, so it reveals nothing.
 */
function keyIdFor(raw: string): string {
  return createHash("sha256").update(raw.trim()).digest("hex").slice(0, 12);
}

export function isSandboxMode(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * The credentials for one hostel.
 *
 * In sandbox mode every hostel resolves to the same env-configured merchant, and
 * the returned `sandbox: true` is carried through to the UI — a resident must
 * never be shown a live-looking payment screen that is wired to a test merchant.
 */
export async function getGatewayCredentials(
  hostelId: Types.ObjectId | string,
): Promise<GatewayCredentials> {
  if (isSandboxMode()) {
    const merchantCode = process.env[SANDBOX_ENV.merchantCode];
    const secret = process.env[SANDBOX_ENV.secret];

    if (!merchantCode || !secret) {
      throw new FinanceServiceError(
        `Sandbox gateway credentials are not configured. Set ${SANDBOX_ENV.merchantCode} and ${SANDBOX_ENV.secret}.`,
        "GATEWAY_NOT_CONFIGURED",
      );
    }

    return {
      merchantCode,
      sandbox: true,
      secret,
      // Providers that sign callbacks with the same shared key need no second
      // value; the fallback keeps their configuration to two variables.
      webhookSecret: process.env[SANDBOX_ENV.webhookSecret] ?? secret,
    };
  }

  await connectToDatabase();

  const profile = await HostelPaymentProfileModel.findOne({ hostelId })
    .select("gatewayEnabledAt gatewayMerchantCode gatewayProvider")
    .lean<{
      gatewayEnabledAt?: Date;
      gatewayMerchantCode?: string;
      gatewayProvider?: string;
    } | null>();

  if (!profile?.gatewayMerchantCode || !profile.gatewayEnabledAt) {
    throw new FinanceServiceError(
      "This hostel has not completed its payment gateway setup.",
      "GATEWAY_NOT_CONFIGURED",
    );
  }

  const [secret, webhookSecret] = await Promise.all([
    readSecret(hostelId, "GATEWAY_SECRET"),
    readSecret(hostelId, "GATEWAY_WEBHOOK_SECRET").catch(() => null),
  ]);

  if (!secret) {
    // The profile says the gateway is on and the signing key is missing. Failing
    // loudly beats falling back to sandbox: a live QR signed with a test key
    // sends a resident's money to the wrong merchant.
    throw new FinanceServiceError(
      "This hostel's gateway signing key is missing. Re-enter it in payment setup.",
      "GATEWAY_NOT_CONFIGURED",
    );
  }

  return {
    merchantCode: profile.gatewayMerchantCode,
    sandbox: false,
    secret,
    webhookSecret: webhookSecret ?? secret,
  };
}

/**
 * Stores or replaces a hostel's secret.
 *
 * Upserts rather than appends: two live signing secrets for one merchant means a
 * signature verifying under a key nobody meant to still accept. The audit entry
 * records the fingerprint, never the value — enough to prove *that* the key
 * changed and who changed it, which is what an audit trail is for.
 */
export async function putSecret(input: {
  hostelId: Types.ObjectId | string;
  plaintext: string;
  principal: ApiPrincipal;
  purpose: SecretPurpose;
}): Promise<{ fingerprint: string }> {
  await connectToDatabase();

  const trimmed = input.plaintext.trim();

  if (trimmed.length === 0) {
    throw new FinanceServiceError(
      "A gateway secret cannot be blank.",
      "GATEWAY_NOT_CONFIGURED",
    );
  }

  const scope = scopeOf(input.hostelId, input.purpose);
  const existing = await EncryptedSecretModel.findOne({
    hostelId: input.hostelId,
    purpose: input.purpose,
  })
    .select("fingerprint")
    .lean<{ fingerprint?: string } | null>();

  const envelope = encryptSecret(trimmed, scope, masterKeys()[0]!);

  await EncryptedSecretModel.updateOne(
    { hostelId: input.hostelId, purpose: input.purpose },
    {
      $set: { ...envelope, rotatedAt: existing ? new Date() : undefined },
      $setOnInsert: {
        createdBy: input.principal.userId,
        hostelId: input.hostelId,
        purpose: input.purpose,
      },
    },
    { upsert: true },
  );

  await auditFinanceAction(input.principal, {
    action: existing ? "GATEWAY_SECRET_ROTATED" : "GATEWAY_SECRET_STORED",
    // No money moves; the envelope requires both amounts, and zero is honest.
    amountAfter: 0,
    amountBefore: 0,
    entityId: new Types.ObjectId(String(input.hostelId)),
    entityType: "EncryptedSecret",
    hostelId: input.hostelId,
    reason: `${input.purpose} fingerprint ${envelope.fingerprint}`,
    source: "SECRET_STORE",
  });

  return { fingerprint: envelope.fingerprint };
}

/** Decrypts one secret, or null when the hostel has none of that purpose. */
export async function readSecret(
  hostelId: Types.ObjectId | string,
  purpose: SecretPurpose,
): Promise<string | null> {
  await connectToDatabase();

  const row = await EncryptedSecretModel.findOne({ hostelId, purpose }).lean<
    (SecretEnvelope & { _id: Types.ObjectId }) | null
  >();

  if (!row) {
    return null;
  }

  const plaintext = decryptSecret(row, scopeOf(hostelId, purpose), masterKeys());

  // Best effort, and never awaited into the caller's critical path: a usage
  // timestamp that fails to write must not stop a payment from being verified.
  void EncryptedSecretModel.updateOne(
    { _id: row._id },
    { $set: { lastUsedAt: new Date() } },
  ).catch(() => undefined);

  return plaintext;
}

/**
 * What the settings screen may show: that a secret exists, and which one.
 *
 * The value is never returned by any code path — there is no "reveal" endpoint
 * and no way to add one without changing this signature. An operator who needs
 * to know whether the key they hold is the key we hold compares fingerprints.
 */
export async function describeSecret(
  hostelId: Types.ObjectId | string,
  purpose: SecretPurpose,
): Promise<{
  configured: boolean;
  fingerprint: string | null;
  rotatedAt: Date | null;
  updatedAt: Date | null;
}> {
  await connectToDatabase();

  const row = await EncryptedSecretModel.findOne({ hostelId, purpose })
    .select("fingerprint rotatedAt updatedAt")
    .lean<{ fingerprint?: string; rotatedAt?: Date; updatedAt?: Date } | null>();

  return {
    configured: Boolean(row),
    fingerprint: row?.fingerprint ?? null,
    rotatedAt: row?.rotatedAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Confirms a candidate matches what is stored, without revealing either. */
export function matchesFingerprint(
  candidate: string,
  storedFingerprint: string,
  hostelId: Types.ObjectId | string,
  purpose: SecretPurpose,
): boolean {
  return (
    fingerprintSecret(candidate.trim(), scopeOf(hostelId, purpose)) ===
    storedFingerprint
  );
}

/**
 * Rewraps every secret still held under an outgoing master key.
 *
 * Run after moving the old value to `FINANCE_MASTER_KEY_PREVIOUS` and the new
 * one to `FINANCE_MASTER_KEY`. Ciphertexts are untouched — only the wrapped data
 * keys move — so this is N small writes, and it is resumable: a row already
 * rewrapped is skipped, so a run that dies halfway is re-run rather than
 * unpicked.
 */
export async function rotateMasterKey(): Promise<{
  failed: number;
  rewrapped: number;
  skipped: number;
}> {
  await connectToDatabase();

  const keys = masterKeys();
  const target = keys[0]!;
  const rows = await EncryptedSecretModel.find({ keyId: { $ne: target.id } }).lean<
    (SecretEnvelope & {
      _id: Types.ObjectId;
      hostelId: Types.ObjectId;
      purpose: SecretPurpose;
    })[]
  >();

  let failed = 0;
  let rewrapped = 0;

  for (const row of rows) {
    try {
      const next = rewrapSecret(
        row,
        scopeOf(row.hostelId, row.purpose),
        keys,
        target,
      );

      await EncryptedSecretModel.updateOne(
        { _id: row._id },
        {
          $set: {
            keyId: next.keyId,
            wrappedKey: next.wrappedKey,
            wrappedKeyIv: next.wrappedKeyIv,
            wrappedKeyTag: next.wrappedKeyTag,
          },
        },
      );

      rewrapped += 1;
    } catch {
      // A row no configured key can open. Counted, never deleted: the secret is
      // unreadable, not gone, and an operator who finds the missing key can
      // still recover it.
      failed += 1;
    }
  }

  return { failed, rewrapped, skipped: 0 };
}

function scopeOf(
  hostelId: Types.ObjectId | string,
  purpose: SecretPurpose,
): SecretScope {
  return { hostelId: hostelId.toString(), purpose };
}
