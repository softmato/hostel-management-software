import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Envelope encryption for finance secrets (ADR-6, D5).
 *
 * Separate from `EncryptedSecret` and from `secret-store.ts` on purpose: this
 * module has no database and no environment of its own — keys are passed in —
 * so every property below can be tested directly, including the ones that only
 * matter when something goes wrong.
 *
 * **Why an envelope rather than encrypting with the master key directly**, as
 * `personal-data-crypto.ts` does: each secret gets its own random data key, and
 * only that data key is wrapped by the master key. Rotating the master key then
 * rewraps N 32-byte keys instead of re-encrypting and rewriting N secrets. That
 * is the difference between a rotation somebody runs and a rotation somebody
 * schedules and never performs.
 *
 * **Why associated data.** Both layers bind their ciphertext to
 * `{hostelId, purpose}` via GCM's AAD. The ciphertext is therefore only valid in
 * the row it was written for: copying hostel A's `ciphertext` into hostel B's
 * document produces an authentication failure, not hostel A's signing key.
 * Without it, a database write — from a bug, a bad migration, or someone with
 * collection access — silently makes one hostel able to sign as another.
 *
 * **Why decryption failure is opaque.** Every failure raises the same error with
 * no detail about which stage failed. Distinguishing "wrong key" from "tampered
 * ciphertext" from "unknown format" hands an attacker with write access an
 * oracle, and tells a legitimate operator nothing they cannot get from
 * `keyId` and `fingerprint`, which are stored in the clear for exactly that.
 */

export const ENVELOPE_FORMAT = "v1";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const FINGERPRINT_CHARS = 16;

export type MasterKey = {
  /** Recorded on every row this key wraps, so rotation can find them again. */
  id: string;
  key: Buffer;
};

export type SecretEnvelope = {
  authTag: string;
  ciphertext: string;
  fingerprint: string;
  format: string;
  iv: string;
  keyId: string;
  wrappedKey: string;
  wrappedKeyIv: string;
  wrappedKeyTag: string;
};

/** The scope a ciphertext is bound to. Both parts are authenticated. */
export type SecretScope = {
  hostelId: string;
  purpose: string;
};

export class SecretCryptoError extends Error {
  errorCode = "SECRET_UNREADABLE";
  status = 500;

  constructor(message = "A stored secret could not be read.") {
    super(message);
    this.name = "SecretCryptoError";
  }
}

/**
 * Parses a master key from its configured form.
 *
 * Accepts 32 raw bytes as hex or base64 and **nothing else**. Deliberately
 * unlike `personal-data-crypto.ts`, which stretches any passphrase to 32 bytes
 * rather than fail: that trade is defensible for a feature that degrades if the
 * key is missing, and indefensible here, because a short passphrase silently
 * becomes the key protecting every hostel's payment signing secret. A key with
 * insufficient entropy must be a startup error somebody has to fix, not a
 * weakness the code quietly accommodates.
 */
export function parseMasterKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const candidate = /^[a-f\d]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");

  if (candidate.length !== KEY_BYTES) {
    throw new SecretCryptoError(
      "A finance master key must be 32 bytes, hex or base64. Generate one with: openssl rand -base64 32",
    );
  }

  return candidate;
}

/** `sha256(purpose:hostelId:plaintext)`, truncated. Never reversible in practice. */
export function fingerprintSecret(plaintext: string, scope: SecretScope): string {
  return createHash("sha256")
    .update(`${scope.purpose}:${scope.hostelId}:${plaintext}`)
    .digest("hex")
    .slice(0, FINGERPRINT_CHARS);
}

function associatedData(scope: SecretScope): Buffer {
  return Buffer.from(`${ENVELOPE_FORMAT}:${scope.hostelId}:${scope.purpose}`, "utf8");
}

export function encryptSecret(
  plaintext: string,
  scope: SecretScope,
  masterKey: MasterKey,
): SecretEnvelope {
  if (plaintext.length === 0) {
    throw new SecretCryptoError("Refusing to store an empty secret.");
  }

  const aad = associatedData(scope);

  // A fresh data key per secret. Two hostels with identical merchant secrets
  // still produce unrelated ciphertexts, and compromising one data key exposes
  // exactly one secret.
  const dataKey = randomBytes(KEY_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, dataKey, iv);

  cipher.setAAD(aad);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const wrapIv = randomBytes(IV_BYTES);
  const wrapper = createCipheriv(ALGORITHM, masterKey.key, wrapIv);

  wrapper.setAAD(aad);

  const wrappedKey = Buffer.concat([wrapper.update(dataKey), wrapper.final()]);

  // The data key does not outlive this function beyond the buffers above. Node
  // gives no guarantee about when they are collected, so this is hygiene rather
  // than a defence — but leaving it live in a module-level cache would be a
  // real one.
  dataKey.fill(0);

  return {
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    fingerprint: fingerprintSecret(plaintext, scope),
    format: ENVELOPE_FORMAT,
    iv: iv.toString("base64"),
    keyId: masterKey.id,
    wrappedKey: wrappedKey.toString("base64"),
    wrappedKeyIv: wrapIv.toString("base64"),
    wrappedKeyTag: wrapper.getAuthTag().toString("base64"),
  };
}

/**
 * Unwraps and decrypts, trying each candidate master key in turn.
 *
 * More than one key is accepted so a rotation can run with the outgoing key
 * still configured: rows wrapped by either open, and a rewrap pass can move them
 * across without downtime. `keyId` is used to try the *right* key first, but is
 * not trusted to be correct — it is stored data, and the AAD and auth tag are
 * what actually decide.
 */
export function decryptSecret(
  envelope: SecretEnvelope,
  scope: SecretScope,
  masterKeys: MasterKey[],
): string {
  if (envelope.format !== ENVELOPE_FORMAT) {
    throw new SecretCryptoError();
  }

  const ordered = [
    ...masterKeys.filter((candidate) => candidate.id === envelope.keyId),
    ...masterKeys.filter((candidate) => candidate.id !== envelope.keyId),
  ];

  for (const candidate of ordered) {
    const plaintext = tryDecrypt(envelope, scope, candidate);

    if (plaintext !== null) {
      return plaintext;
    }
  }

  // One error for every failure mode — see the module comment.
  throw new SecretCryptoError();
}

function tryDecrypt(
  envelope: SecretEnvelope,
  scope: SecretScope,
  masterKey: MasterKey,
): string | null {
  const aad = associatedData(scope);

  try {
    const unwrapper = createDecipheriv(
      ALGORITHM,
      masterKey.key,
      Buffer.from(envelope.wrappedKeyIv, "base64"),
    );

    unwrapper.setAAD(aad);
    unwrapper.setAuthTag(Buffer.from(envelope.wrappedKeyTag, "base64"));

    const dataKey = Buffer.concat([
      unwrapper.update(Buffer.from(envelope.wrappedKey, "base64")),
      unwrapper.final(),
    ]);

    const decipher = createDecipheriv(
      ALGORITHM,
      dataKey,
      Buffer.from(envelope.iv, "base64"),
    );

    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");

    dataKey.fill(0);

    return plaintext;
  } catch {
    // Wrong key, tampered ciphertext, or ciphertext from another hostel. The
    // caller is told none of these apart — see the module comment.
    return null;
  }
}

/**
 * Rewraps a data key under a new master key **without touching the ciphertext**.
 *
 * This is the whole operational point of the envelope: rotating the master key
 * is N small writes of a wrapped 32-byte key, not N re-encryptions of secrets
 * that would each have to be decrypted into process memory first.
 */
export function rewrapSecret(
  envelope: SecretEnvelope,
  scope: SecretScope,
  from: MasterKey[],
  to: MasterKey,
): SecretEnvelope {
  const aad = associatedData(scope);
  const ordered = [
    ...from.filter((candidate) => candidate.id === envelope.keyId),
    ...from.filter((candidate) => candidate.id !== envelope.keyId),
  ];

  for (const candidate of ordered) {
    let dataKey: Buffer;

    try {
      const unwrapper = createDecipheriv(
        ALGORITHM,
        candidate.key,
        Buffer.from(envelope.wrappedKeyIv, "base64"),
      );

      unwrapper.setAAD(aad);
      unwrapper.setAuthTag(Buffer.from(envelope.wrappedKeyTag, "base64"));

      dataKey = Buffer.concat([
        unwrapper.update(Buffer.from(envelope.wrappedKey, "base64")),
        unwrapper.final(),
      ]);
    } catch {
      continue;
    }

    const wrapIv = randomBytes(IV_BYTES);
    const wrapper = createCipheriv(ALGORITHM, to.key, wrapIv);

    wrapper.setAAD(aad);

    const wrappedKey = Buffer.concat([wrapper.update(dataKey), wrapper.final()]);

    dataKey.fill(0);

    return {
      ...envelope,
      keyId: to.id,
      wrappedKey: wrappedKey.toString("base64"),
      wrappedKeyIv: wrapIv.toString("base64"),
      wrappedKeyTag: wrapper.getAuthTag().toString("base64"),
    };
  }

  throw new SecretCryptoError();
}

/**
 * Constant-time comparison, for verifying a webhook signature (6.1).
 *
 * Lives here rather than in the webhook service because the mistake it prevents
 * — `a === b` on an HMAC, which leaks the correct digest one byte at a time
 * through timing — is made once and never noticed.
 */
export function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");

  // Length is not secret; comparing different-length buffers throws.
  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}
