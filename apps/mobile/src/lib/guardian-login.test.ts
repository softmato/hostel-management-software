import { describe, expect, it } from "vitest";

import {
  guardianLoginPayload,
  hasGuardianLoginErrors,
  normalizeAccessCode,
  normalizeGuardianPhone,
  validateGuardianLogin,
} from "@/lib/guardian-login";

describe("normalizeAccessCode", () => {
  /*
   * `loginGuardian` uppercases before it looks the row up, so a lower-case code
   * typed exactly right would otherwise fail as "invalid".
   */
  it("uppercases, because the server does", () => {
    expect(normalizeAccessCode("ab12cd")).toBe("AB12CD");
  });

  it("drops the separators people add when copying a code", () => {
    expect(normalizeAccessCode(" AB12 CD ")).toBe("AB12CD");
    expect(normalizeAccessCode("AB12-CD")).toBe("AB12CD");
  });

  /*
   * Codes issued before 2026-08-17 came from `Math.random().toString(36)` and
   * can contain 0, 1, i and o — the characters the new generator omits. A
   * client-side alphabet check would lock out every guardian holding one.
   */
  it("does not police the alphabet, so old codes still go through", () => {
    expect(normalizeAccessCode("io01xy")).toBe("IO01XY");
    expect(hasGuardianLoginErrors(validateGuardianLogin({
      accessCode: "io01xy",
      phone: "9800000000",
    }))).toBe(false);
  });
});

describe("normalizeGuardianPhone", () => {
  it("strips spacing and brackets but keeps a country code", () => {
    expect(normalizeGuardianPhone("+977 (98) 0000-0000")).toBe("+9779800000000");
  });
});

describe("validateGuardianLogin", () => {
  const valid = { accessCode: "AB12CD", phone: "9800000000" };

  it("passes a well-formed code and phone", () => {
    expect(validateGuardianLogin(valid)).toEqual({});
  });

  it("asks for each field when it is missing", () => {
    const errors = validateGuardianLogin({ accessCode: "  ", phone: "" });

    expect(errors.accessCode).toBeTruthy();
    expect(errors.phone).toBeTruthy();
  });

  /*
   * The bounds are the server's, not stricter. A client stricter than the
   * server rejects logins the server would have accepted, and the person on the
   * phone has no way to find out why.
   */
  it("matches the server's bounds exactly", () => {
    expect(validateGuardianLogin({ ...valid, accessCode: "ABC" }).accessCode).toBeTruthy();
    expect(validateGuardianLogin({ ...valid, accessCode: "ABCD" }).accessCode).toBeUndefined();
    expect(
      validateGuardianLogin({ ...valid, accessCode: "A".repeat(24) }).accessCode,
    ).toBeUndefined();
    expect(
      validateGuardianLogin({ ...valid, accessCode: "A".repeat(25) }).accessCode,
    ).toBeTruthy();

    expect(validateGuardianLogin({ ...valid, phone: "98000" }).phone).toBeTruthy();
    expect(validateGuardianLogin({ ...valid, phone: "980000" }).phone).toBeUndefined();
    expect(validateGuardianLogin({ ...valid, phone: "9".repeat(33) }).phone).toBeTruthy();
  });

  it("measures the normalised value, not what was typed", () => {
    // "AB 12 CD" is 8 characters typed and 6 on the wire; the max is what
    // matters here — a spaced-out 24-character code must still pass.
    const spaced = `${"A".repeat(24).match(/.{1,4}/g)?.join(" ")}`;

    expect(validateGuardianLogin({ ...valid, accessCode: spaced }).accessCode).toBeUndefined();
  });
});

describe("guardianLoginPayload", () => {
  it("sends the normalised pair, not the raw draft", () => {
    expect(
      guardianLoginPayload({ accessCode: " ab12-cd ", phone: "+977 98-0000-0000" }),
    ).toEqual({ accessCode: "AB12CD", phone: "+9779800000000" });
  });
});
