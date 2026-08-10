/**
 * Envelope encryption — Block 6 item 6.0 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (ADR-6, D5).
 *
 * A pure module protecting the most dangerous thing this system will ever
 * store — the key a hostel's payments are signed with — so the tests are about
 * what happens when something is *wrong*: the key is short, the ciphertext was
 * moved between hostels, a byte was flipped, the master key rotated. Each of
 * those has a way of failing safely and a way of failing silently, and the
 * difference is what is asserted here.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  type MasterKey,
  type SecretScope,
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  parseMasterKey,
  rewrapSecret,
  SecretCryptoError,
  secretsMatch,
} from "@/modules/finance/gateway/envelope-crypto";

const KEY_A: MasterKey = { id: "keyA", key: randomBytes(32) };
const KEY_B: MasterKey = { id: "keyB", key: randomBytes(32) };

const RUPA: SecretScope = { hostelId: "hostel-rupa", purpose: "GATEWAY_SECRET" };
const EVEREST: SecretScope = {
  hostelId: "hostel-everest",
  purpose: "GATEWAY_SECRET",
};

const SECRET = "fp_live_9f3c1a7e2b8d4056";

describe("parseMasterKey", () => {
  it("accepts 32 bytes as base64 or hex", () => {
    const key = randomBytes(32);

    expect(parseMasterKey(key.toString("base64"))).toEqual(key);
    expect(parseMasterKey(key.toString("hex"))).toEqual(key);
  });

  it("refuses a short passphrase instead of stretching it", () => {
    // `personal-data-crypto.ts` stretches any passphrase to 32 bytes rather
    // than fail — defensible for a feature that degrades without a key, and
    // indefensible here, where the stretched value silently becomes the key
    // protecting every hostel's payment signing secret.
    expect(() => parseMasterKey("hunter2")).toThrow(SecretCryptoError);
    expect(() => parseMasterKey("")).toThrow(SecretCryptoError);
  });

  it("refuses a key of nearly the right length", () => {
    expect(() => parseMasterKey(randomBytes(31).toString("base64"))).toThrow(
      SecretCryptoError,
    );
  });
});

describe("round trip", () => {
  it("returns exactly what was stored", () => {
    const envelope = encryptSecret(SECRET, RUPA, KEY_A);

    expect(decryptSecret(envelope, RUPA, [KEY_A])).toBe(SECRET);
  });

  it("never puts the plaintext in the envelope", () => {
    const envelope = encryptSecret(SECRET, RUPA, KEY_A);

    expect(JSON.stringify(envelope)).not.toContain(SECRET);
  });

  it("gives two identical secrets unrelated ciphertexts", () => {
    // A fresh data key per secret. Otherwise two hostels using the same
    // provider default would be visibly identical in the database.
    const first = encryptSecret(SECRET, RUPA, KEY_A);
    const second = encryptSecret(SECRET, EVEREST, KEY_A);

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.wrappedKey).not.toBe(second.wrappedKey);
  });

  it("survives unicode and long secrets", () => {
    const awkward = `${"x".repeat(4096)}·नेपाल·🔐`;
    const envelope = encryptSecret(awkward, RUPA, KEY_A);

    expect(decryptSecret(envelope, RUPA, [KEY_A])).toBe(awkward);
  });

  it("refuses to store nothing", () => {
    expect(() => encryptSecret("", RUPA, KEY_A)).toThrow(SecretCryptoError);
  });
});

describe("a ciphertext is bound to its row", () => {
  it("cannot be decrypted for a different hostel", () => {
    // The attack this stops: copy hostel A's ciphertext into hostel B's row,
    // and B can sign as A. Without associated data that is a silent success.
    const envelope = encryptSecret(SECRET, RUPA, KEY_A);

    expect(() => decryptSecret(envelope, EVEREST, [KEY_A])).toThrow(SecretCryptoError);
  });

  it("cannot be decrypted for a different purpose", () => {
    const envelope = encryptSecret(SECRET, RUPA, KEY_A);

    expect(() =>
      decryptSecret(
        envelope,
        { ...RUPA, purpose: "GATEWAY_WEBHOOK_SECRET" },
        [KEY_A],
      ),
    ).toThrow(SecretCryptoError);
  });
});

describe("tampering", () => {
  it("rejects a flipped byte in the ciphertext", () => {
    const envelope = encryptSecret(SECRET, RUPA, KEY_A);
    const bytes = Buffer.from(envelope.ciphertext, "base64");

    bytes[0] ^= 0xff;

    expect(() =>
      decryptSecret({ ...envelope, ciphertext: bytes.toString("base64") }, RUPA, [
        KEY_A,
      ]),
    ).toThrow(SecretCryptoError);
  });

  it("rejects a swapped auth tag", () => {
    const envelope = encryptSecret(SECRET, RUPA, KEY_A);
    const other = encryptSecret("something-else", RUPA, KEY_A);

    expect(() =>
      decryptSecret({ ...envelope, authTag: other.authTag }, RUPA, [KEY_A]),
    ).toThrow(SecretCryptoError);
  });

  it("rejects a wrapped key borrowed from another envelope", () => {
    const envelope = encryptSecret(SECRET, RUPA, KEY_A);
    const other = encryptSecret(SECRET, RUPA, KEY_A);

    expect(() =>
      decryptSecret({ ...envelope, wrappedKey: other.wrappedKey }, RUPA, [KEY_A]),
    ).toThrow(SecretCryptoError);
  });

  it("rejects the wrong master key", () => {
    const envelope = encryptSecret(SECRET, RUPA, KEY_A);

    expect(() => decryptSecret(envelope, RUPA, [KEY_B])).toThrow(SecretCryptoError);
  });

  it("rejects an unknown envelope format", () => {
    const envelope = encryptSecret(SECRET, RUPA, KEY_A);

    expect(() => decryptSecret({ ...envelope, format: "v2" }, RUPA, [KEY_A])).toThrow(
      SecretCryptoError,
    );
  });

  it("says the same thing however it failed", () => {
    const envelope = encryptSecret(SECRET, RUPA, KEY_A);
    const messages = new Set<string>();

    for (const broken of [
      () => decryptSecret(envelope, EVEREST, [KEY_A]),
      () => decryptSecret(envelope, RUPA, [KEY_B]),
      () => decryptSecret({ ...envelope, ciphertext: "AAAA" }, RUPA, [KEY_A]),
    ]) {
      try {
        broken();
      } catch (error) {
        messages.add((error as Error).message);
      }
    }

    // Distinguishing "wrong key" from "tampered" hands an attacker with write
    // access an oracle, and tells a legitimate operator nothing that `keyId`
    // and `fingerprint` do not already say in the clear.
    expect(messages.size).toBe(1);
  });
});

describe("master key rotation", () => {
  it("opens rows wrapped by either configured key", () => {
    const old = encryptSecret(SECRET, RUPA, KEY_A);

    expect(decryptSecret(old, RUPA, [KEY_B, KEY_A])).toBe(SECRET);
  });

  it("rewraps without touching the ciphertext", () => {
    // The operational point of the envelope: rotation is N writes of a wrapped
    // 32-byte key, not N re-encryptions that each pull a secret into memory.
    const before = encryptSecret(SECRET, RUPA, KEY_A);
    const after = rewrapSecret(before, RUPA, [KEY_A], KEY_B);

    expect(after.ciphertext).toBe(before.ciphertext);
    expect(after.iv).toBe(before.iv);
    expect(after.keyId).toBe("keyB");
    expect(after.wrappedKey).not.toBe(before.wrappedKey);
  });

  it("leaves the rewrapped row readable under the new key alone", () => {
    const after = rewrapSecret(encryptSecret(SECRET, RUPA, KEY_A), RUPA, [KEY_A], KEY_B);

    expect(decryptSecret(after, RUPA, [KEY_B])).toBe(SECRET);
    expect(() => decryptSecret(after, RUPA, [KEY_A])).toThrow(SecretCryptoError);
  });

  it("refuses to rewrap a row no configured key can open", () => {
    const orphan = encryptSecret(SECRET, RUPA, KEY_A);

    expect(() => rewrapSecret(orphan, RUPA, [KEY_B], KEY_B)).toThrow(SecretCryptoError);
  });

  it("still opens a row whose stored keyId is wrong", () => {
    // `keyId` is a hint for ordering, not an authority — it is stored data, and
    // the auth tag is what actually decides.
    const envelope = { ...encryptSecret(SECRET, RUPA, KEY_A), keyId: "keyB" };

    expect(decryptSecret(envelope, RUPA, [KEY_B, KEY_A])).toBe(SECRET);
  });
});

describe("fingerprints", () => {
  it("matches for the same secret in the same place", () => {
    expect(fingerprintSecret(SECRET, RUPA)).toBe(fingerprintSecret(SECRET, RUPA));
  });

  it("differs for the same secret in a different hostel", () => {
    // Otherwise a fingerprint on a shared screen would reveal that two hostels
    // use the same key.
    expect(fingerprintSecret(SECRET, RUPA)).not.toBe(fingerprintSecret(SECRET, EVEREST));
  });

  it("changes when the secret changes", () => {
    expect(fingerprintSecret(SECRET, RUPA)).not.toBe(
      fingerprintSecret(`${SECRET}x`, RUPA),
    );
  });

  it("is short enough not to be a hash of the secret worth attacking", () => {
    expect(fingerprintSecret(SECRET, RUPA)).toHaveLength(16);
  });
});

describe("secretsMatch", () => {
  it("compares equal strings as equal", () => {
    expect(secretsMatch("abc123", "abc123")).toBe(true);
  });

  it("rejects a difference anywhere in the string", () => {
    expect(secretsMatch("abc123", "abc124")).toBe(false);
    expect(secretsMatch("abc123", "zbc123")).toBe(false);
  });

  it("handles different lengths without throwing", () => {
    // `timingSafeEqual` throws on mismatched lengths, which would turn a bad
    // signature into a 500 instead of a rejection.
    expect(secretsMatch("short", "considerably-longer")).toBe(false);
    expect(secretsMatch("", "x")).toBe(false);
  });
});
