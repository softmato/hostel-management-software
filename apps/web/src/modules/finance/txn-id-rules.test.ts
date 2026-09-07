import { describe, expect, it } from "vitest";

import {
  TXN_ID_FLAGS,
  providersWithTxnIdRules,
  txnIdFlags,
  txnIdVerdict,
} from "@/modules/finance/txn-id-rules";

/**
 * Every id below is real, taken from the golden set's hand-labelled manifest.
 * That is the point of the module: a rule derived from invented ids would be a
 * confident amber flag on honest residents.
 */

/** The sixteen eSewa ids the rule was derived from. */
const REAL_ESEWA = [
  "1QAXP2M",
  "1Q5Z3E2",
  "1QAX4PU",
  "1PYWSS2",
  "1Q1RYMU",
  "1PVB1KH",
  "1PSRKEV",
  "1PUW3MQ",
  "1NVX5KB",
  "1PS5YFP",
  "1NW2DT8",
  "1OEJ1E5",
  "1NWIJV9",
  "1P57I03",
  "1PIW8BZ",
  "1PD5FB9",
];

describe("txnIdVerdict", () => {
  it.each(REAL_ESEWA)("accepts the real eSewa id %s", (id) => {
    expect(txnIdVerdict("ESEWA", id)).toBe("VALID_SHAPE");
  });

  it("rejects a phone number typed into the transaction field", () => {
    // The commonest wrong value on a real claim: the receipt shows the payer's
    // mobile right beside the id, and it is ten digits rather than seven.
    expect(txnIdVerdict("ESEWA", "9824870400")).toBe("INVALID_SHAPE");
  });

  it("rejects a bank reference pasted against an eSewa payment", () => {
    expect(txnIdVerdict("ESEWA", "114903707")).toBe("INVALID_SHAPE");
  });

  it("rejects an invented id of the wrong length", () => {
    expect(txnIdVerdict("ESEWA", "1QAXP2MX")).toBe("INVALID_SHAPE");
    expect(txnIdVerdict("ESEWA", "1QAXP2")).toBe("INVALID_SHAPE");
  });

  it("ignores separators and case, because the same id is printed both ways", () => {
    // eSewa's own PDF and its app render ids differently; Khalti's differ by
    // hyphens alone. A rule that did not canonicalise would call one of each
    // pair malformed.
    expect(txnIdVerdict("ESEWA", " 1qaxp2m ")).toBe("VALID_SHAPE");
    expect(txnIdVerdict("ESEWA", "1QA-XP2M")).toBe("VALID_SHAPE");
  });

  it("says nothing about a provider with no registered rule", () => {
    // Khalti has two real samples and Fonepay's bank references come in two
    // shapes. Neither is a basis for flagging somebody's rent.
    expect(txnIdVerdict("KHALTI", "jhmy94Nqpybs2QDh8tACWc")).toBe("UNKNOWN_PROVIDER");
    expect(txnIdVerdict("KHALTI", "obviously-made-up")).toBe("UNKNOWN_PROVIDER");
    expect(txnIdVerdict("BANK_TRANSFER", "114903707")).toBe("UNKNOWN_PROVIDER");
    expect(txnIdVerdict("FONEPAY", "EVBLNPKAXP-112491077")).toBe("UNKNOWN_PROVIDER");
  });

  it("says nothing when there is no id and nothing when there is no method", () => {
    // Whether an id is *required* is `transactionCodeRequired`'s question.
    // Answering it here too is how two screens end up disagreeing.
    expect(txnIdVerdict("ESEWA", "")).toBe("UNKNOWN_PROVIDER");
    expect(txnIdVerdict("ESEWA", null)).toBe("UNKNOWN_PROVIDER");
    expect(txnIdVerdict(null, "1QAXP2M")).toBe("UNKNOWN_PROVIDER");
    expect(txnIdVerdict("CASH", "")).toBe("UNKNOWN_PROVIDER");
  });

  it("does not pin the leading character", () => {
    // All sixteen samples start with `1` and the second character walks N to Q
    // in date order, so the id is a counter. Pinning the first character works
    // until eSewa reaches the next digit and then flags every genuine receipt on
    // the platform on the same day.
    expect(txnIdVerdict("ESEWA", "2AAAAAA")).toBe("VALID_SHAPE");
  });
});

describe("txnIdFlags", () => {
  it("raises the amber flag on a malformed id", () => {
    expect(txnIdFlags("ESEWA", "9824870400")).toEqual([TXN_ID_FLAGS.MALFORMED]);
  });

  it("raises the positive flag on a well-formed one", () => {
    expect(txnIdFlags("ESEWA", "1QAXP2M")).toEqual([TXN_ID_FLAGS.SHAPE_OK]);
  });

  it("raises neither for an unregistered provider", () => {
    expect(txnIdFlags("KHALTI", "anything-at-all")).toEqual([]);
  });
});

describe("the registry itself", () => {
  it("records how every rule was derived", () => {
    // A rule with no evidence line is a guess, and a guessed rule produces
    // confident amber flags on honest residents.
    const rules = providersWithTxnIdRules();

    expect(rules.length).toBeGreaterThan(0);

    for (const rule of rules) {
      expect(rule.evidence.length).toBeGreaterThan(40);
    }
  });
});
