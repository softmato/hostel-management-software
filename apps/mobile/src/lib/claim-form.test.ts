import { describe, expect, it } from "vitest";

import { hasErrors, parseClaimAmount, validateClaim } from "@/lib/claim-form";

function draft(overrides: Partial<Parameters<typeof validateClaim>[0]> = {}) {
  return {
    amount: "8500",
    method: "ESEWA",
    proofAssetId: "asset-1",
    transactionCode: "",
    ...overrides,
  };
}

/**
 * The submit endpoint is rate-limited to 8 an hour because each call runs OCR
 * over a full-size screenshot. Every invalid claim the client lets through
 * spends one of a resident's eight attempts to be told something the phone
 * already knew.
 */
describe("parseClaimAmount", () => {
  it("accepts a plain whole-rupee amount", () => {
    expect(parseClaimAmount("8500")).toBe(8500);
  });

  it("tolerates the separators people actually type", () => {
    expect(parseClaimAmount(" 12,000 ")).toBe(12000);
  });

  it("rejects paisa — whole rupees are the ledger's foundation (ADR-1)", () => {
    expect(parseClaimAmount("1200.50")).toBeNull();
  });

  it("rejects zero, negatives and junk", () => {
    expect(parseClaimAmount("0")).toBeNull();
    expect(parseClaimAmount("-500")).toBeNull();
    expect(parseClaimAmount("eight thousand")).toBeNull();
    expect(parseClaimAmount("")).toBeNull();
  });
});

describe("validateClaim", () => {
  it("passes a complete draft", () => {
    expect(hasErrors(validateClaim(draft()))).toBe(false);
  });

  it("requires evidence — the screenshot is the whole claim", () => {
    const errors = validateClaim(draft({ proofAssetId: null }));

    expect(errors.proofAssetId).toBeTruthy();
  });

  it("distinguishes a missing amount from an unparseable one", () => {
    expect(validateClaim(draft({ amount: "" })).amount).toBe("Enter the amount you paid.");
    expect(validateClaim(draft({ amount: "1200.5" })).amount).toContain("whole rupee");
  });

  it("requires a method — a defaulted one is a wrong fact in the evidence", () => {
    expect(validateClaim(draft({ method: null })).method).toBeTruthy();
  });

  it("caps the transaction code at the server's limit", () => {
    expect(validateClaim(draft({ transactionCode: "x".repeat(121) })).transactionCode).toBeTruthy();
    expect(validateClaim(draft({ transactionCode: "x".repeat(120) })).transactionCode).toBeUndefined();
  });
});
