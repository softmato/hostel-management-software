/**
 * Reading a receipt as a document with fields, per provider.
 *
 * The fixtures are the three shapes residents actually send — a wallet's
 * post-payment screenshot, a bank's two-column receipt, and a month-long
 * statement — written the way a recogniser returns them: no punctuation between
 * a label and its value, columns collapsed to runs of spaces.
 *
 * The statement cases carry the most weight. A statement is a legitimate document
 * a resident will genuinely upload, and it is the one where reading fields is
 * actively harmful: every label matches the first row that has it, so a payee
 * read off a statement names whoever they paid first that month.
 */
import { describe, expect, it } from "vitest";

import {
  detectProvider,
  labelledValue,
  looksLikeStatement,
  methodForProvider,
  parseReceipt,
} from "./evidence-receipt";

/** eSewa's `Payment Successful` card, as recognised from a phone screenshot. */
const esewaScreenshot = [
  "eSewa",
  "Payment Successful",
  "Rs. 8,500.00",
  "Transaction Code: 8823119471",
  "Sent to: Sunrise Boys Hostel",
  "From: 9801234521",
  "Remarks: EDU-0002-P",
  "Date: 2026-08-04 10:14 AM",
].join("\n");

/** Khalti's confirmation screen for a merchant payment. */
const khaltiScreenshot = [
  "Khalti",
  "Payment Successful",
  "Amount Rs. 8,500",
  "Purchase Order ID  KHL7734X21",
  "Paid to  Sunrise Boys Hostel",
  "Mobile  9801234521",
  "Remarks  EDU-0002-P",
].join("\n");

/** Everest Bank's two-column `Payment Receipt`. */
const bankReceipt = [
  "EBL EVEREST BANK",
  "Payment Receipt",
  "Reference Code   111903076",
  "Date/Time   10 Aug 2026,07:10 PM",
  "Channel   Online",
  "Amount (NPR)   8,500.00",
  "Initiator   9709155982",
  "Qr Merchant Name   Sunrise Boys Hostel",
  "Remarks   EDU-0002-P",
  "Status   SUCCESS",
].join("\n");

/** An eSewa statement export, photographed — `Cr.`/`Dr.` columns and many rows. */
const esewaStatement = [
  "eSewa",
  "Transaction Statement",
  "Date | Reference Code | Description | Cr. | Dr. | Balance",
  "01 Aug | 8823110001 | Fund Transferred by Ramesh Shrestha | 2,000.0 | 0.0 | 5,400",
  "04 Aug | 8823119471 | Fund Transferred to Sunrise Boys Hostel | 0.0 | 8,500.0 | 1,900",
  "Total | | | 2,000.0 | 8,500.0 |",
].join("\n");

describe("detectProvider", () => {
  it.each([
    [esewaScreenshot, "ESEWA"],
    [khaltiScreenshot, "KHALTI"],
    [bankReceipt, "BANK"],
    [["Fonepay", "Trace ID 99213", "Merchant Name Sunrise"].join("\n"), "FONEPAY"],
    [["ConnectIPS", "Beneficiary Name: Sunrise", "NPR 8,500"].join("\n"), "CONNECTIPS"],
  ])("recognises the issuer", (text, provider) => {
    expect(detectProvider(text)).toBe(provider);
  });

  it("prefers the wallet over the bank when a receipt names both", () => {
    // An eSewa receipt for a bank transfer mentions the bank; eSewa issued the
    // document, and its labels are the ones that will parse.
    expect(
      detectProvider(["eSewa", "Bank Transfer to Nabil Bank", "Rs. 8,500"].join("\n")),
    ).toBe("ESEWA");
  });

  it("says UNKNOWN rather than guessing", () => {
    expect(detectProvider("Rs. 8,500 paid, thanks")).toBe("UNKNOWN");
  });
});

describe("parseReceipt — the wallet screenshot", () => {
  it("reads every field off an eSewa card", () => {
    const parsed = parseReceipt(esewaScreenshot);

    expect(parsed).toMatchObject({
      amount: 8500,
      direction: "DEBIT",
      payee: "Sunrise Boys Hostel",
      provider: "ESEWA",
      remarks: "EDU-0002-P",
      shape: "RECEIPT",
      txnId: "8823119471",
    });
  });

  it("reads Khalti's tabular layout, and its Purchase Order ID", () => {
    const parsed = parseReceipt(khaltiScreenshot);

    expect(parsed.provider).toBe("KHALTI");
    expect(parsed.payee).toBe("Sunrise Boys Hostel");
    expect(parsed.amount).toBe(8500);
    expect(parsed.txnId).toBeTruthy();
  });
});

describe("parseReceipt — the bank's two-column receipt", () => {
  it("reads the merchant, amount and reference out of table cells", () => {
    const parsed = parseReceipt(bankReceipt);

    expect(parsed).toMatchObject({
      amount: 8500,
      payee: "Sunrise Boys Hostel",
      provider: "BANK",
      shape: "RECEIPT",
      txnId: "111903076",
    });
  });

  it("reads the payer out of `Initiator`, which is the bank's word for it", () => {
    // Not a name here but a mobile number, which `toName` discards rather than
    // handing on to be compared against a person.
    expect(parseReceipt(bankReceipt).payer).toBeNull();
  });

  it("takes the number out of an amount field carrying a currency label", () => {
    expect(parseReceipt(bankReceipt).amount).toBe(8500);
  });
});

describe("parseReceipt — the statement", () => {
  it("recognises an eSewa statement by its Cr./Dr. column pair", () => {
    expect(looksLikeStatement(esewaStatement)).toBe(true);
    expect(parseReceipt(esewaStatement).shape).toBe("STATEMENT");
  });

  it("recognises a Khalti statement by its Amount(+)/Amount(-) pair", () => {
    const khaltiStatement = [
      "Khalti",
      "Transaction Date | Transaction ID | Amount(+) Rs | Amount(-) Rs",
      "01 Aug | KHL001 | 2,000 | 0",
    ].join("\n");

    expect(looksLikeStatement(khaltiStatement)).toBe(true);
  });

  it("recognises one by its heading even when the columns are cropped away", () => {
    expect(looksLikeStatement("NABIL BANK\nAccount Statement\n01 Aug ...")).toBe(true);
  });

  it("reads no fields off it, however many labels it carries", () => {
    // The point of the shape. Every label on a statement matches the first row
    // that has it, so a payee read here would name whoever the resident paid
    // first that month — and that name would be handed to the payee check as the
    // recipient of *this* payment.
    const parsed = parseReceipt(esewaStatement);

    expect(parsed.payee).toBeNull();
    expect(parsed.amount).toBeNull();
    expect(parsed.txnId).toBeNull();
    expect(parsed.provider).toBe("ESEWA");
  });

  it("does not call a receipt a statement for printing a running balance", () => {
    // Plenty of single-payment receipts show the balance afterwards, and calling
    // those statements would send residents back for a file they already sent.
    const withBalance = [
      "eSewa",
      "Payment Successful",
      "Sent to: Sunrise Boys Hostel",
      "Rs. 8,500.00",
      "Balance: 1,900.00",
    ].join("\n");

    expect(looksLikeStatement(withBalance)).toBe(false);
    expect(parseReceipt(withBalance).shape).toBe("RECEIPT");
  });
});

describe("labelledValue — the layouts a recognised receipt has", () => {
  it.each([
    ["Transaction Code: 8823119471", "8823119471"],
    ["Transaction Code   8823119471", "8823119471"],
    ["Transaction Code | 8823119471", "8823119471"],
    ["Transaction Code\n8823119471", "8823119471"],
  ])("reads %s", (line, expected) => {
    expect(labelledValue(`eSewa\n${line}\nRs. 8,500`, /transaction\s*code/)).toBe(
      expected,
    );
  });

  it("returns null when the label is not there", () => {
    expect(labelledValue("eSewa\nRs. 8,500", /transaction\s*code/)).toBeNull();
  });
});

describe("parseReceipt — fields that are not values", () => {
  it("discards N/A rather than treating it as a payee", () => {
    const parsed = parseReceipt(
      ["eSewa", "Payment Successful", "Sent to: N/A", "Rs. 8,500"].join("\n"),
    );

    expect(parsed.payee).toBeNull();
    // With no payee read, the template asserts no direction either — the generic
    // reader is left to answer it.
    expect(parsed.direction).toBeNull();
  });

  it("discards a bare account number in the payee field", () => {
    const parsed = parseReceipt(
      ["eSewa", "Payment Successful", "Sent to: 9801234507", "Rs. 8,500"].join("\n"),
    );

    expect(parsed.payee).toBeNull();
  });

  it("refuses an absurd amount rather than reading a balance as one", () => {
    const parsed = parseReceipt(
      ["eSewa", "Payment Successful", "Amount: 99,999,999,999", "Sent to: X Hostel"].join(
        "\n",
      ),
    );

    expect(parsed.amount).toBeNull();
  });
});

describe("methodForProvider", () => {
  it.each([
    ["ESEWA", "ESEWA"],
    ["KHALTI", "KHALTI"],
    ["FONEPAY", "FONEPAY"],
    ["BANK", "BANK_TRANSFER"],
    ["CONNECTIPS", "BANK_TRANSFER"],
  ] as const)("maps %s to the form's vocabulary", (provider, method) => {
    expect(methodForProvider(provider)).toBe(method);
  });

  it("returns null for UNKNOWN, so `unread` cannot look like a mismatch", () => {
    expect(methodForProvider("UNKNOWN")).toBeNull();
  });
});
