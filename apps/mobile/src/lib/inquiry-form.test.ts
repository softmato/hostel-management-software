import { describe, expect, it } from "vitest";

import { hasInquiryErrors, normalizePhone, validateInquiry } from "@/lib/inquiry-form";

function draft(overrides: Partial<Parameters<typeof validateInquiry>[0]> = {}) {
  return { email: "", message: "", name: "Sita Rai", phone: "9800000000", ...overrides };
}

describe("normalizePhone", () => {
  it("strips the formatting people actually type", () => {
    expect(normalizePhone("+977 (980) 000-0000")).toBe("+9779800000000");
  });
});

describe("validateInquiry", () => {
  it("passes a name and a phone number, nothing else required", () => {
    // This form gets filled in on a bus. Every extra required field is a reason
    // to close the app.
    expect(hasInquiryErrors(validateInquiry(draft()))).toBe(false);
  });

  it("accepts a +977 number and a landline", () => {
    expect(validateInquiry(draft({ phone: "+977 9800000000" })).phone).toBeUndefined();
    expect(validateInquiry(draft({ phone: "01-4567890" })).phone).toBeUndefined();
  });

  it("rejects a number that is not one", () => {
    expect(validateInquiry(draft({ phone: "call me" })).phone).toBeTruthy();
    expect(validateInquiry(draft({ phone: "" })).phone).toBeTruthy();
  });

  it("requires a usable name", () => {
    expect(validateInquiry(draft({ name: "A" })).name).toBeTruthy();
    expect(validateInquiry(draft({ name: "  " })).name).toBeTruthy();
  });

  it("lets email be blank but not wrong", () => {
    // A typo means the reply goes nowhere and the student concludes they were
    // ignored.
    expect(validateInquiry(draft({ email: "" })).email).toBeUndefined();
    expect(validateInquiry(draft({ email: "sita@example.com" })).email).toBeUndefined();
    expect(validateInquiry(draft({ email: "sita@example" })).email).toBeTruthy();
  });

  it("caps the message at the server's limit", () => {
    expect(validateInquiry(draft({ message: "x".repeat(1201) })).message).toBeTruthy();
    expect(validateInquiry(draft({ message: "x".repeat(1200) })).message).toBeUndefined();
  });
});
