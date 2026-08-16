/**
 * Transaction-id plausibility (gap fix 3).
 *
 * The case that motivated it: a resident uploads any image, types `dummy` in the
 * transaction field, quotes the right invoice code — and every review check goes
 * green, so `Approve all` settles a month nobody paid.
 *
 * The two halves of the balance these keep: placeholders must not get through,
 * and no real provider reference may be refused. The second is the expensive one
 * to get wrong — a bounced genuine payment is a resident at the hostel office.
 */
import { describe, expect, it } from "vitest";

import {
  transactionCodeProblem,
  transactionCodeRequired,
} from "./transaction-code";

describe("transactionCodeProblem — refuses what cannot be an id", () => {
  it("refuses placeholders however they are cased or spaced", () => {
    for (const value of ["dummy", "DUMMY", "test", "  Testing ", "n/a", "none"]) {
      expect(transactionCodeProblem(value), value).not.toBeNull();
    }
  });

  it("refuses repeated characters and sequences", () => {
    for (const value of ["000000", "aaaaaa", "123456", "654321", "abcdef"]) {
      expect(transactionCodeProblem(value), value).not.toBeNull();
    }
  });

  it("refuses anything too short to be a reference", () => {
    expect(transactionCodeProblem("123")).toMatch(/too short/i);
  });

  it("refuses a value with no digits, which is a word and not an id", () => {
    expect(transactionCodeProblem("PAIDBYESEWA")).toMatch(/numbers/i);
  });
});

describe("transactionCodeProblem — passes real references", () => {
  it("accepts the formats the providers actually issue", () => {
    for (const value of [
      "8823119471", // eSewa transaction code
      "0KL2H7B91", // eSewa alphanumeric
      "TXN-8823119", // hyphenated, as pasted
      "FP2026071900112233", // Fonepay trace
      "9481203", // short bank serial
      "RRN 004512889", // spaced, as printed on a slip
      "a1b2c3d4e5f6", // Khalti-style id
    ]) {
      expect(transactionCodeProblem(value), value).toBeNull();
    }
  });

  it("does not refuse a prefix that merely contains a placeholder word", () => {
    // `TEST` is a placeholder on its own; a bank whose reference starts with
    // those letters is not.
    expect(transactionCodeProblem("TESTA9481203")).toBeNull();
  });

  it("treats an empty value as the caller's decision, not an error", () => {
    // Whether the id is *required* depends on the payment method, which is
    // `transactionCodeRequired`'s question rather than this one's.
    expect(transactionCodeProblem("")).toBeNull();
    expect(transactionCodeProblem(undefined)).toBeNull();
  });
});

describe("transactionCodeRequired", () => {
  it("requires an id from every method that issues one", () => {
    for (const method of ["ESEWA", "KHALTI", "FONEPAY", "BANK_TRANSFER"]) {
      expect(transactionCodeRequired(method), method).toBe(true);
    }
  });

  it("does not require one for cash or the escape hatch", () => {
    // Cash has no id to give, and for a cash claim the same form field holds a
    // warden's name — which every rule above would refuse.
    expect(transactionCodeRequired("CASH")).toBe(false);
    expect(transactionCodeRequired("OTHER")).toBe(false);
  });
});
