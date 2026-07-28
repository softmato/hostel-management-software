import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Envelope encryption for the personal data users hand us once and re-share
 * with hostels (UserResidentProfile). We promise them the data is stored
 * encrypted, so it must never hit the database in plaintext — including in
 * indexes, which is why the whole payload is a single opaque blob.
 *
 * Format: `v1.<iv b64>.<authTag b64>.<ciphertext b64>` (AES-256-GCM).
 */

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function decodeKey(raw: string) {
  const trimmed = raw.trim();

  // Accept hex or base64 so operators can paste whatever `openssl rand` gave them.
  const candidate = /^[a-f\d]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");

  if (candidate.length === KEY_BYTES) {
    return candidate;
  }

  // Any other passphrase is stretched to 32 bytes rather than rejected, so a
  // misconfigured length does not take the whole feature down.
  return createHash("sha256").update(trimmed).digest();
}

function encryptionKey() {
  if (cachedKey) {
    return cachedKey;
  }

  const raw = process.env.PERSONAL_DATA_ENCRYPTION_KEY;

  if (!raw) {
    throw new Error(
      "PERSONAL_DATA_ENCRYPTION_KEY is required to store or read resident profiles. " +
        "Generate one with: openssl rand -base64 32",
    );
  }

  cachedKey = decodeKey(raw);

  return cachedKey;
}

/** Test helper — forces the next call to re-read the environment. */
export function resetPersonalDataKeyCache() {
  cachedKey = null;
}

export function isPersonalDataEncryptionConfigured() {
  return Boolean(process.env.PERSONAL_DATA_ENCRYPTION_KEY);
}

export function encryptPersonalData(value: unknown) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);

  return [
    VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptPersonalData<T>(envelope: string): T {
  const [version, ivPart, tagPart, cipherPart] = envelope.split(".");

  if (version !== VERSION || !ivPart || !tagPart || !cipherPart) {
    throw new Error("Stored personal data is in an unrecognised format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivPart, "base64"),
  );

  decipher.setAuthTag(Buffer.from(tagPart, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(cipherPart, "base64")),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(plaintext) as T;
}
