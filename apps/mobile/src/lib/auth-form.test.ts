import { describe, expect, it } from "vitest";

import {
  extractResetToken,
  isCompleteOtpCode,
  isProbablyEmail,
  normalizeOtpCode,
  validatePassword,
  validateRegister,
} from "@/lib/auth-form";

const token = "a".repeat(40);

describe("validateRegister", () => {
  const valid = { email: "sita@example.com", name: "Sita Sharma", password: "hunter22" };

  it("accepts a complete draft", () => {
    expect(validateRegister(valid)).toEqual({});
  });

  it("rejects a one-character name, matching the server's min of 2", () => {
    expect(validateRegister({ ...valid, name: "S" }).name).toBeDefined();
    expect(validateRegister({ ...valid, name: "Si" }).name).toBeUndefined();
  });

  it("rejects a name past the server's 120 limit", () => {
    expect(validateRegister({ ...valid, name: "a".repeat(121) }).name).toBeDefined();
  });

  it("catches the two email typos that actually happen", () => {
    expect(validateRegister({ ...valid, email: "sita@gmail" }).email).toBeDefined();
    expect(validateRegister({ ...valid, email: "sita.gmail.com" }).email).toBeDefined();
  });

  it("says something different when the email is simply missing", () => {
    expect(validateRegister({ ...valid, email: "  " }).email).toContain("code");
  });

  it("enforces the server's 8-character password floor and nothing more", () => {
    expect(validateRegister({ ...valid, password: "short12" }).password).toBeDefined();
    // No complexity rule: the server has none, and inventing one here rejects
    // passwords the server would have taken.
    expect(validateRegister({ ...valid, password: "aaaaaaaa" }).password).toBeUndefined();
  });
});

describe("validatePassword", () => {
  it("returns null for an acceptable password", () => {
    expect(validatePassword("hunter22")).toBeNull();
  });

  it("distinguishes empty from too short", () => {
    expect(validatePassword("")).toBe("Choose a password.");
    expect(validatePassword("abc")).toContain("At least");
  });

  it("rejects past the server's 128 ceiling", () => {
    expect(validatePassword("a".repeat(129))).toContain("At most");
    expect(validatePassword("a".repeat(128))).toBeNull();
  });
});

describe("isProbablyEmail", () => {
  it("ignores surrounding whitespace, which a paste always brings", () => {
    expect(isProbablyEmail("  sita@example.com ")).toBe(true);
  });

  it("rejects a domain with no dot", () => {
    expect(isProbablyEmail("sita@localhost")).toBe(false);
  });
});

describe("normalizeOtpCode", () => {
  it("strips the spaces people paste out of the email", () => {
    expect(normalizeOtpCode("123 456")).toBe("123456");
    expect(normalizeOtpCode("123-456")).toBe("123456");
  });

  it("stops at six digits rather than sending a longer code", () => {
    expect(normalizeOtpCode("1234567890")).toBe("123456");
  });

  it("knows when the code is complete", () => {
    expect(isCompleteOtpCode("12345")).toBe(false);
    expect(isCompleteOtpCode("12 34 56")).toBe(true);
  });
});

describe("extractResetToken", () => {
  it("takes the token out of the emailed link", () => {
    expect(extractResetToken(`https://hostelhub.test/reset-password?token=${token}`)).toBe(
      token,
    );
  });

  it("accepts a bare token too", () => {
    expect(extractResetToken(`  ${token}  `)).toBe(token);
  });

  it("decodes percent-encoding some mail clients add", () => {
    const encoded = `${token}.${encodeURIComponent("a/b+c=")}`;

    expect(extractResetToken(`https://x.test/reset-password?token=${encoded}`)).toBe(
      `${token}.a/b+c=`,
    );
  });

  it("stops at the next query parameter", () => {
    expect(extractResetToken(`https://x.test/r?token=${token}&utm=email`)).toBe(token);
  });

  it("refuses a URL that carries no token rather than posting the URL", () => {
    expect(extractResetToken("https://hostelhub.test/reset-password")).toBeNull();
  });

  it("refuses anything shorter than the server's 20-character floor", () => {
    expect(extractResetToken("abc")).toBeNull();
    expect(extractResetToken("")).toBeNull();
  });
});
