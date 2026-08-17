import { describe, expect, it } from "vitest";

import {
  isValidReferralCode,
  normalizeReferralCode,
  parseReferralLink,
} from "@/lib/referral-link";

describe("parseReferralLink", () => {
  it("reads the link the resident portal actually shares", () => {
    expect(parseReferralLink("https://hostelhub.com.np/inquiry?ref=SITA24")).toBe(
      "SITA24",
    );
  });

  it("reads the app's own scheme", () => {
    expect(parseReferralLink("hostelhub://ref/SITA24")).toBe("SITA24");
  });

  it("reads a /ref/ path on a web host too", () => {
    expect(parseReferralLink("https://hostelhub.com.np/ref/SITA24")).toBe("SITA24");
  });

  it("finds the code after other parameters, and stops at the next one", () => {
    expect(parseReferralLink("https://x.test/inquiry?utm=fb&ref=SITA24")).toBe(
      "SITA24",
    );
    expect(parseReferralLink("https://x.test/inquiry?ref=SITA24&utm=fb")).toBe(
      "SITA24",
    );
    expect(parseReferralLink("https://x.test/inquiry?ref=SITA24#form")).toBe("SITA24");
  });

  it("accepts the referralCode spelling the API uses", () => {
    expect(parseReferralLink("https://x.test/inquiry?referralCode=SITA24")).toBe(
      "SITA24",
    );
  });

  it("decodes a percent-encoded code", () => {
    expect(parseReferralLink("hostelhub://ref/SITA%3224")).toBe("SITA224");
  });

  it("accepts a bare code", () => {
    expect(parseReferralLink("sita24")).toBe("SITA24");
  });

  it("takes a four-character code, which the activation validator would reject", () => {
    expect(parseReferralLink("hostelhub://ref/AB12")).toBe("AB12");
  });

  it("rejects links that are not referrals", () => {
    expect(parseReferralLink("hostelhub://hostel/green-view")).toBeNull();
    expect(parseReferralLink("https://example.com/about")).toBeNull();
    expect(parseReferralLink("")).toBeNull();
  });

  it("rejects codes outside the schema's range", () => {
    expect(parseReferralLink("hostelhub://ref/AB")).toBeNull();
    expect(parseReferralLink(`hostelhub://ref/${"A".repeat(33)}`)).toBeNull();
    expect(parseReferralLink(`hostelhub://ref/${"A".repeat(32)}`)).toBe("A".repeat(32));
  });
});

describe("normalizeReferralCode", () => {
  it("upper-cases and strips whitespace", () => {
    expect(normalizeReferralCode(" sita 24 ")).toBe("SITA24");
  });
});

describe("isValidReferralCode", () => {
  it("uses the referral range, not the activation one", () => {
    expect(isValidReferralCode("AB12")).toBe(true);
    expect(isValidReferralCode("AB1")).toBe(false);
  });
});
