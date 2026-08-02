import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptPersonalData,
  encryptPersonalData,
  isPersonalDataEncryptionConfigured,
  resetPersonalDataKeyCache,
} from "@/lib/personal-data-crypto";

const KEY = "33sNHIKo0dappPIkKmewahgtpi7Dq/1SN8yH4Vgdo1s=";

const profile = {
  bloodGroup: "O+",
  fullName: "Asha Rai",
  guardianPhone: "9800000000",
  interests: ["football", "music"],
};

describe("personal data crypto", () => {
  beforeEach(() => {
    process.env.PERSONAL_DATA_ENCRYPTION_KEY = KEY;
    resetPersonalDataKeyCache();
  });

  afterEach(() => {
    delete process.env.PERSONAL_DATA_ENCRYPTION_KEY;
    resetPersonalDataKeyCache();
  });

  it("round-trips a profile payload", () => {
    expect(decryptPersonalData(encryptPersonalData(profile))).toEqual(profile);
  });

  it("never leaves plaintext in the envelope", () => {
    const envelope = encryptPersonalData(profile);

    expect(envelope).toMatch(/^v1\./);
    expect(envelope).not.toContain("Asha");
    expect(envelope).not.toContain("9800000000");
  });

  it("produces a different ciphertext each time", () => {
    // A fresh IV per write stops two identical profiles being correlatable.
    expect(encryptPersonalData(profile)).not.toEqual(encryptPersonalData(profile));
  });

  it("rejects a tampered ciphertext", () => {
    const [version, iv, tag, cipher] = encryptPersonalData(profile).split(".");
    const flipped = Buffer.from(cipher, "base64");
    flipped[0] ^= 0xff;

    expect(() =>
      decryptPersonalData([version, iv, tag, flipped.toString("base64")].join(".")),
    ).toThrow();
  });

  it("rejects an envelope in an unknown format", () => {
    expect(() => decryptPersonalData("not-an-envelope")).toThrow(/unrecognised format/i);
  });

  it("cannot be read with a different key", () => {
    const envelope = encryptPersonalData(profile);

    process.env.PERSONAL_DATA_ENCRYPTION_KEY =
      "Yl9kZXZfa2V5X2Zvcl90ZXN0c19vbmx5X25vdF9yZWFsIQ==";
    resetPersonalDataKeyCache();

    expect(() => decryptPersonalData(envelope)).toThrow();
  });

  it("fails loudly when no key is configured", () => {
    delete process.env.PERSONAL_DATA_ENCRYPTION_KEY;
    resetPersonalDataKeyCache();

    expect(isPersonalDataEncryptionConfigured()).toBe(false);
    expect(() => encryptPersonalData(profile)).toThrow(/PERSONAL_DATA_ENCRYPTION_KEY/);
  });
});
