import { describe, expect, it } from "vitest";

import {
  isValidReferralCode,
  normalizeReferralCode,
  readReferralCode,
} from "@/lib/referral-code";

describe("normalizeReferralCode", () => {
  it("strips whitespace and upper-cases", () => {
    expect(normalizeReferralCode(" ab c123 ")).toBe("ABC123");
  });
});

describe("isValidReferralCode", () => {
  it("accepts the server's 4–32 range", () => {
    // Four is deliberate: `referredInquiryCreateSchema` allows it even though
    // `activationCodeSchema` starts at six. Tightening this to six would drop a
    // valid referral with no error anyone could see.
    expect(isValidReferralCode("ABCD")).toBe(true);
    expect(isValidReferralCode("A".repeat(32))).toBe(true);
  });

  it("rejects codes outside it", () => {
    expect(isValidReferralCode("ABC")).toBe(false);
    expect(isValidReferralCode("A".repeat(33))).toBe(false);
    expect(isValidReferralCode("")).toBe(false);
  });
});

describe("readReferralCode", () => {
  it("reads the `ref` the service generates", () => {
    // `referral.service.ts` builds `link: /inquiry?ref=<code>`.
    expect(readReferralCode(new URLSearchParams("ref=abc123"))).toBe("ABC123");
  });

  it("also reads the two spellings a hand-edited link grows", () => {
    expect(readReferralCode(new URLSearchParams("referral=abc123"))).toBe("ABC123");
    expect(readReferralCode(new URLSearchParams("refCode=abc123"))).toBe("ABC123");
  });

  it("ignores a code the server would reject", () => {
    // Falls through to the ordinary inquiry flow rather than posting a value
    // that returns a 400 reading as "the form is broken".
    expect(readReferralCode(new URLSearchParams("ref=ab"))).toBeNull();
    expect(readReferralCode(new URLSearchParams("ref="))).toBeNull();
  });

  it("returns null when there is no referral at all", () => {
    expect(readReferralCode(new URLSearchParams("hostel=green-view-hostel"))).toBeNull();
    expect(readReferralCode(null)).toBeNull();
  });

  it("prefers `ref` when more than one is present", () => {
    expect(readReferralCode(new URLSearchParams("ref=aaaa&referral=bbbb"))).toBe("AAAA");
  });
});
