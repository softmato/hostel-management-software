/**
 * Which way the money moved.
 *
 * The case that motivated the module is the first one tested: a credit-side
 * transaction PDF — money arriving in the resident's own wallet — which passed
 * every other check in the pipeline because every other check only asks whether
 * the numbers agree, and on a credit receipt they do.
 *
 * The second thing tested, at greater length, is the direction it must *not*
 * decide. A wrong refusal here tells a resident who genuinely paid that their
 * proof is backwards, which is worse than an amber flag by a wide margin, so
 * every ambiguous shape below has to come out `UNKNOWN`.
 */
import { describe, expect, it } from "vitest";

import {
  directionRefusal,
  outcomeRefusal,
  readEvidenceDirection,
} from "./evidence-direction";

/** The resident's own "Send Money" receipt — the shape a real claim carries. */
const debitReceipt = [
  "eSewa",
  "Payment Successful",
  "Rs. 8,500.00",
  "Transaction Code 8823119471",
  "Sent to: Sunrise Boys Hostel",
  "Debited from: 98XXXXXX07",
].join("\n");

/** The file that started this: money arriving, submitted as proof of paying. */
const creditReceipt = [
  "eSewa",
  "Transaction Successful",
  "Rs. 8,500.00",
  "Transaction Code 8823119471",
  "Received from: Ramesh Shrestha",
  "Amount credited to your account",
].join("\n");

describe("readEvidenceDirection — the credit receipt that used to pass", () => {
  it("reads money arriving as CREDIT", () => {
    const read = readEvidenceDirection(creditReceipt);

    expect(read.direction).toBe("CREDIT");
    expect(read.signals).toContain("received from");
  });

  it("refuses it, in words that say which file to fetch instead", () => {
    const refusal = directionRefusal(readEvidenceDirection(creditReceipt));

    expect(refusal).toMatch(/coming \*into\* your account/);
    expect(refusal).toMatch(/leaving your account/);
  });

  it("catches a bank's credit advice with no verb at all", () => {
    const advice = [
      "NIC ASIA BANK",
      "Credit Advice",
      "Amount Credited: NPR 8,500.00",
      "Sender: RAMESH SHRESTHA",
      "Date: 2026-08-04",
    ].join("\n");

    expect(readEvidenceDirection(advice).direction).toBe("CREDIT");
  });

  it("catches a wallet load, which is money in even though the resident initiated it", () => {
    const load = ["Khalti", "Load Fund Successful", "Rs. 8,500.00"].join("\n");

    expect(readEvidenceDirection(load).direction).toBe("CREDIT");
  });

  it("catches a refund, which is a real transaction in the wrong direction", () => {
    const refund = ["eSewa", "Refund Successful", "Rs. 8,500.00 refunded"].join("\n");

    expect(readEvidenceDirection(refund).direction).toBe("CREDIT");
  });
});

describe("readEvidenceDirection — the receipts that must get through", () => {
  it("reads a Send Money receipt as DEBIT", () => {
    const read = readEvidenceDirection(debitReceipt);

    expect(read.direction).toBe("DEBIT");
    expect(directionRefusal(read)).toBeNull();
  });

  it("does not flip on the payee line, which says `credited to` about the hostel", () => {
    // The trap this module is most likely to fall into: on the payer's own
    // receipt, "Credited to" names where their money went. Reading it as an
    // incoming credit would refuse the receipts we most want to accept.
    const read = readEvidenceDirection(
      ["Global IME Bank", "Fund Transfer", "Debited from: 0801...4471", "Credited to: SUNRISE HOSTEL PVT LTD", "NPR 8,500.00"].join("\n"),
    );

    expect(read.direction).toBe("DEBIT");
  });

  it("does not flip on a `Payee` or `Beneficiary` heading", () => {
    const read = readEvidenceDirection(
      ["ConnectIPS", "Payment Successful", "Beneficiary: Sunrise Hostel", "NPR 8,500"].join("\n"),
    );

    expect(read.direction).toBe("DEBIT");
  });

  it("stays UNKNOWN rather than refusing when nothing says either way", () => {
    const bare = ["Khalti", "Rs. 8,500.00", "Transaction ID: 8823119471", "2026-08-04"].join("\n");
    const read = readEvidenceDirection(bare);

    expect(read.direction).toBe("UNKNOWN");
    expect(directionRefusal(read)).toBeNull();
  });

  it("stays UNKNOWN on unreadable evidence rather than guessing", () => {
    expect(readEvidenceDirection(null).direction).toBe("UNKNOWN");
    expect(readEvidenceDirection("").direction).toBe("UNKNOWN");
  });
});

/**
 * A real Everest Bank QR receipt, recognised.
 *
 * The receipt a resident actually submitted, and it broke the first version of
 * this module twice over: it carries **no directional word anywhere** — not
 * `sent`, not `paid to`, not `debited`, not `transferred` — and yet it was
 * refused as a credit, on the strength of a fragment OCR produced out of the
 * bank's logo. Two failures at once: it could not read the direction that was
 * there, and it invented one that was not.
 */
const eblQrReceipt = [
  "EBL EVEREST BANK",
  "Payment Receipt",
  "Reference Code 111903076",
  "Date/Time 10 Aug 2026,07:10 PM",
  "Channel Online",
  "Payment Attribute 2222090020887310/chitya/194011457u4T/TEA TIME ANYTIME CAFETERIA",
  "Service Name Mobile Convergent",
  "Amount (NPR) 70.00",
  "Amount In Words (NPR) Seventy Rupees Only",
  "Initiator 9709155982",
  "Qr Merchant Name TEA TIME ANYTIME CAFETERIA",
  "Remarks chitya",
  "Status SUCCESS",
  "Thank you for using EBL Touch 24.",
].join("\n");

describe("readEvidenceDirection — a receipt with no directional word on it", () => {
  it("reads the Everest Bank QR receipt as DEBIT from its shape", () => {
    // A merchant, a QR and an initiator exist only on the paying side. Nobody
    // receives money via a `Qr Merchant Name`, and the `Initiator` of a payment
    // is by definition whoever's account it left.
    const read = readEvidenceDirection(eblQrReceipt);

    expect(read.direction).toBe("DEBIT");
    expect(read.signals).toContain("qr merchant");
    expect(directionRefusal(read)).toBeNull();
  });

  it("does not refuse on a stray `cr` of the kind OCR makes out of a logo", () => {
    // The actual failure: a two-letter fragment turned a genuine payment into
    // "your receipt shows money coming into your account". A refusal has to rest
    // on a phrase that can mean only one thing.
    const noisy = [
      "Cr",
      "Payment Receipt",
      "Amount (NPR) 70.00",
      "Status SUCCESS",
    ].join("\n");
    const read = readEvidenceDirection(noisy);

    expect(read.strongCredit).toBe(false);
    expect(directionRefusal(read)).toBeNull();
  });

  it("still refuses when a strong phrase backs the weak one", () => {
    const read = readEvidenceDirection(
      ["Cr", "Received from: Ramesh Shrestha", "Amount 8,500"].join("\n"),
    );

    expect(read.strongCredit).toBe(true);
    expect(directionRefusal(read)).not.toBeNull();
  });
});

describe("readEvidenceDirection — statements carry both directions", () => {
  it("does not refuse an account statement, where both families appear", () => {
    const statement = [
      "NABIL BANK — Account Statement",
      "Date | Description | Debit | Credit | Balance",
      "01/08 | Salary | | 45,000 | 52,000",
      "04/08 | Transfer to SUNRISE HOSTEL | 8,500 | | 43,500",
      "Received from RAMESH | | 2,000 | 45,500",
    ].join("\n");
    const read = readEvidenceDirection(statement);

    expect(read.isLedgerView).toBe(true);
    expect(read.direction).toBe("UNKNOWN");
    expect(directionRefusal(read)).toBeNull();
  });
});

describe("readEvidenceDirection — did the money actually move", () => {
  it("refuses a failed transaction", () => {
    const read = readEvidenceDirection(
      ["eSewa", "Transaction Failed", "Rs. 8,500.00", "Sent to: Sunrise Hostel"].join("\n"),
    );

    expect(read.outcome).toBe("FAILED");
    expect(outcomeRefusal(read)).toMatch(/no money left your account/);
  });

  it("refuses a cancelled one", () => {
    const read = readEvidenceDirection(
      ["Khalti", "Payment Cancelled", "Rs. 8,500.00", "Paid to: Sunrise Hostel"].join("\n"),
    );

    expect(read.outcome).toBe("CANCELLED");
    expect(outcomeRefusal(read)).not.toBeNull();
  });

  it("reads failure pessimistically when a page says both", () => {
    // A failure screen often still carries the word `successful` in a footer or a
    // retry prompt. The reviewer must see the pessimistic reading.
    const read = readEvidenceDirection(
      ["eSewa", "Transaction Failed", "Your payment was not successful", "Rs. 8,500"].join("\n"),
    );

    expect(read.outcome).toBe("FAILED");
  });

  it("does not refuse a pending transfer — banks settle those a day later", () => {
    const read = readEvidenceDirection(
      ["Prabhu Bank", "Transfer Pending", "NPR 8,500.00", "Transferred to: Sunrise Hostel"].join("\n"),
    );

    expect(read.outcome).toBe("PENDING");
    expect(outcomeRefusal(read)).toBeNull();
  });

  it("reads a plain success", () => {
    expect(readEvidenceDirection(debitReceipt).outcome).toBe("SUCCESS");
  });
});
