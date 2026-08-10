import { Schema, model, models } from "mongoose";

/**
 * A secret we hold on a hostel's behalf, encrypted at rest (ADR-6, D5).
 *
 * The repo stores every other secret in an environment variable, which works
 * exactly as long as there is one of each. Tier 1 merchant signing keys are
 * **per hostel**, so N hostels means N secrets and env vars stop being an
 * option (D5).
 *
 * **Envelope encryption, not direct encryption.** Each secret gets its own
 * random data key; the data key is wrapped by the master key in
 * `FINANCE_MASTER_KEY`. That indirection buys the thing that matters
 * operationally: rotating the master key rewraps N small data keys instead of
 * re-encrypting and rewriting every secret, so rotation is a job that can
 * actually be run rather than one that gets postponed forever.
 *
 * **Nothing here is queryable.** There is no index on any ciphertext and no
 * plaintext field, deliberately — a searchable secret is a secret that leaks
 * through its own index. The only lookup is by owner and purpose.
 *
 * What this collection may hold: merchant codes' signing secrets and webhook
 * verification secrets. What it must never hold (target §6.7): bank login
 * credentials, an owner's personal banking password, or card details. We keep
 * enough to request a payment and verify one, and nothing else.
 */

const encryptedSecretSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    /**
     * Which provider's key this is (item 6.1).
     *
     * A hostel holds one signing key per provider, so this is part of the row's
     * identity — and part of the encryption's associated data, so a Khalti
     * ciphertext written into the eSewa row fails to authenticate instead of
     * being handed to the eSewa adapter as its signing key.
     */
    provider: {
      type: String,
      enum: ["ESEWA", "FONEPAY", "KHALTI"],
      required: true,
    },
    /**
     * What this secret is for. Part of the encryption's associated data, so a
     * ciphertext cannot be moved between purposes any more than between hostels.
     */
    purpose: {
      type: String,
      enum: ["GATEWAY_SECRET", "GATEWAY_WEBHOOK_SECRET"],
      required: true,
    },

    /** Envelope format marker, e.g. `v1`. Read before anything is decrypted. */
    format: { type: String, required: true, default: "v1" },
    /**
     * Which master key wrapped the data key.
     *
     * Stored so a rotation can tell rewrapped rows from stale ones without
     * trial decryption, and so a key that must be revoked can be traced to
     * exactly the rows that depend on it.
     */
    keyId: { type: String, required: true, trim: true },

    /** The data key, encrypted under the master key. Base64. */
    wrappedKey: { type: String, required: true },
    wrappedKeyIv: { type: String, required: true },
    wrappedKeyTag: { type: String, required: true },

    /** The secret itself, encrypted under the data key. Base64. */
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },

    /**
     * SHA-256 of the plaintext, truncated.
     *
     * Lets an operator answer "did the key I just pasted actually change
     * anything?" and lets a rotation verify a rewrap round-tripped, without
     * either of them decrypting or displaying the secret. Truncated because the
     * full digest of a short, low-entropy secret is brute-forceable.
     */
    fingerprint: { type: String, required: true },

    /** Audit trail. Who installed it, and when it was last actually used. */
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    rotatedAt: Date,
    lastUsedAt: Date,
  },
  { timestamps: true },
);

/**
 * One live secret per hostel per provider per purpose.
 *
 * Replacing a merchant's signing key overwrites this row rather than adding a
 * second one: two live signing secrets for one merchant means a signature that
 * verifies under a key nobody meant to still be accepting.
 */
encryptedSecretSchema.index(
  { hostelId: 1, provider: 1, purpose: 1 },
  { unique: true },
);
/** Finds every row still wrapped by an outgoing master key, for rotation. */
encryptedSecretSchema.index({ keyId: 1 });

export const EncryptedSecretModel =
  models.EncryptedSecret || model("EncryptedSecret", encryptedSecretSchema);
