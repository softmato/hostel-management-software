/**
 * Matching a claim against the text on its own screenshot (gap fix 3).
 *
 * The recogniser is not tested here — an OCR engine is somebody else's tested
 * software, and loading its WASM would cost seconds per test file. What is tested
 * is the judgement layered on top of it, where the false-confirmation risk lives:
 * a wrong "the image matches" is the worst outcome available, because it is the
 * one signal a reviewer would trust without opening the file.
 */
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  evidenceTextFlags,
  extractClaimFields,
  isDefinitelyNotPaymentEvidence,
  looksLikePaymentReceipt,
  matchClaimFacts,
  readEvidenceText,
  receiptSignals,
  referenceOnEvidence,
} from "./evidence-ocr";

const facts = {
  amount: 10000,
  referenceCode: "EDU-0001-F",
  transactionCode: "8823119471",
};

/** What an eSewa receipt actually reads like once recognised. */
const esewa = [
  "eSewa",
  "Payment Successful",
  "Rs. 10,000.00",
  "Transaction Code 8823119471",
  "To: Everest Boys Hostel",
].join("\n");

describe("matchClaimFacts — the amount", () => {
  it("finds it through thousands separators and a trailing decimal", () => {
    expect(matchClaimFacts(esewa, facts).amountFound).toBe(true);
    expect(matchClaimFacts("NPR 10000", facts).amountFound).toBe(true);
    expect(matchClaimFacts("10,000", facts).amountFound).toBe(true);
    expect(matchClaimFacts("10000.00", facts).amountFound).toBe(true);
  });

  it("reads Devanagari digits, which the wallets mix into Latin text", () => {
    expect(matchClaimFacts("रु १०,०००", facts).amountFound).toBe(true);
  });

  it("does not accept a different amount", () => {
    expect(matchClaimFacts("Rs. 1,000.00", facts).amountFound).toBe(false);
    // Substring-style matching would call this a hit, which is exactly the
    // false confirmation this must never produce.
    expect(matchClaimFacts("Rs. 110,000", facts).amountFound).toBe(false);
  });
});

describe("matchClaimFacts — the ids", () => {
  it("finds the transaction id however it is spaced on the receipt", () => {
    expect(matchClaimFacts(esewa, facts).transactionFound).toBe(true);
    expect(matchClaimFacts("Txn: 88 231 194 71", facts).transactionFound).toBe(true);
    expect(matchClaimFacts("ref 8823-1194-71", facts).transactionFound).toBe(true);
  });

  it("survives a single misread digit, which is what OCR actually does", () => {
    // Not hypothetical: on a clean synthetic receipt this engine read
    // `8823113471` for `8823119471`. Without the tolerance, a genuine payment is
    // reported as "ID not on the image".
    expect(matchClaimFacts("Transaction Code 8823113471", facts).transactionFound).toBe(
      true,
    );
  });

  it("survives digits recognised as their look-alike letters", () => {
    // Also measured, from the same run: `BB23118471` — two 8s read as Bs *and* a
    // 9 read as an 8. Three literal mismatches, one after folding.
    expect(matchClaimFacts("Transaction Code BB23118471", facts).transactionFound).toBe(
      true,
    );
  });

  it("does not tolerate two wrong characters", () => {
    // 8823119471 → 7723119471: two substitutions, and neither is a shape
    // collision the fold would undo.
    expect(
      matchClaimFacts("Transaction Code 7723119471", facts).transactionFound,
    ).toBe(false);
  });

  it("does not apply the tolerance to ids short enough to collide", () => {
    // One wildcard in a nine-digit needle starts matching by chance in a page of
    // digits, and a false confirmation is worse than a false amber.
    const nineChars = { ...facts, transactionCode: "123456789" };

    expect(matchClaimFacts("ref 123456780", nineChars).transactionFound).toBe(false);
  });

  it("reads an amount whose digits were recognised as letters", () => {
    // `1O,OOO` — the classic O-for-0 misread. Folded only inside a run that
    // already contains digits, so the `S` of `Rs.` cannot become a 5 and invent
    // an amount.
    expect(matchClaimFacts("Rs. 1O,OOO paid", facts).amountFound).toBe(true);
    expect(matchClaimFacts("Rs. paid", { ...facts, amount: 5 }).amountFound).toBe(
      false,
    );
  });

  it("refuses to match a short id, which would collide by chance", () => {
    const shortId = { ...facts, transactionCode: "123" };

    expect(
      matchClaimFacts("balance 90123 after", shortId).transactionFound,
    ).toBe(false);
  });

  it("finds the invoice's reference code in a remarks field", () => {
    const quoted = matchClaimFacts(
      "Bank transfer\nRemarks: rent edu-0001-f\nAmount 10000",
      facts,
    );

    expect(quoted.referenceFound).toBe(true);
  });

  it("does not confuse another invoice's code for this one", () => {
    expect(
      matchClaimFacts("Remarks: EDU-0002-N", facts).referenceFound,
    ).toBe(false);
  });
});

/**
 * Filling the form in from the receipt.
 *
 * The riskier direction of the two: `matchClaimFacts` is *given* the numbers and
 * only agrees or does not, while this one invents them, and whatever it invents is
 * what the resident submits. So the bar for every assertion here is the same — a
 * blank field costs ten seconds of typing, a confidently wrong one costs a
 * rejected claim.
 */
describe("referenceOnEvidence", () => {
  // What the claim form asks the moment a receipt is uploaded, and the answer it
  // turns into a sentence naming the code. A false "not found" sends somebody who
  // has already paid back into their banking app, so the tolerant forms matter as
  // much as the rejections.
  it("finds the code however the remarks field formatted it", () => {
    expect(referenceOnEvidence("Remarks: EDU-0001-F", "EDU-0001-F")).toBe(true);
    expect(referenceOnEvidence("Purpose EDU 0001 F", "EDU-0001-F")).toBe(true);
    expect(referenceOnEvidence("edu0001f rent", "EDU-0001-F")).toBe(true);
  });

  it("does not find a different invoice's code", () => {
    // The check character is what makes this safe: a neighbouring invoice's code
    // differs in the sequence *and* the check, so nothing folds one into the other.
    expect(referenceOnEvidence("Remarks: EDU-0002-N", "EDU-0001-F")).toBe(false);
  });

  it("says no on a receipt with no remarks at all", () => {
    // The eSewa `Send Money` PDF: everything but the code.
    expect(referenceOnEvidence(esewa, "EDU-0001-F")).toBe(false);
  });

  it("is silent rather than wrong when there is no code to look for", () => {
    expect(referenceOnEvidence(esewa, "")).toBe(false);
  });
});

describe("extractClaimFields", () => {
  it("reads a wallet receipt", () => {
    expect(extractClaimFields(esewa)).toEqual({
      amount: 10000,
      method: "ESEWA",
      transactionCode: "8823119471",
    });
  });

  it("prefers a labelled total over an incidental amount", () => {
    // A receipt with a fee breakdown has several `Rs.` figures and one total.
    const fields = extractClaimFields(
      ["Khalti", "Service charge Rs. 15.00", "Total Amount: Rs. 5,215.00", "Transaction ID: KHT9928311"].join("\n"),
    );

    expect(fields.amount).toBe(5215);
    expect(fields.method).toBe("KHALTI");
    expect(fields.transactionCode).toBe("KHT9928311");
  });

  it("takes the id from its label, never from the longest number", () => {
    // The account number is longer than the reference. Picking by shape would
    // fill the field with the resident's own account number.
    const fields = extractClaimFields(
      ["Global IME Bank", "From A/C 01234567890123456", "Amount 1290", "Reference No: 99481203"].join("\n"),
    );

    expect(fields.transactionCode).toBe("99481203");
    expect(fields.method).toBe("BANK_TRANSFER");
  });

  it("finds the invoice reference a resident put in the remarks", () => {
    expect(
      extractClaimFields("Transfer complete\nRemarks: EDU-0001-F\nAmount 10000")
        .referenceCode,
    ).toBe("EDU-0001-F");
  });

  it("drops paisa rather than rounding, because the ledger is whole rupees", () => {
    expect(extractClaimFields("Total paid Rs. 1,290.50").amount).toBe(1290);
  });

  it("offers nothing rather than something wrong", () => {
    // Every field optional. A photo of a wall fills in nothing, and the resident
    // types the two fields as they did before autofill existed.
    expect(extractClaimFields("Happy Birthday Ramesh")).toEqual({});
  });

  it("refuses to pre-fill an id the submit path would reject", () => {
    // Offering a value that will bounce the moment they press submit is worse
    // than offering none — the resident has no way to know it was our guess.
    expect(
      extractClaimFields("Transaction ID: 000000").transactionCode,
    ).toBeUndefined();
  });

  it("ignores an absurd figure that cannot be a rent payment", () => {
    expect(extractClaimFields("Available balance Rs. 99,999,999.00").amount).toBe(
      undefined,
    );
  });
});

/**
 * "Is this even a payment record?" — the question worth asking before any of the
 * matching, because it is the one the resident can still fix.
 *
 * Two of four signal families, not one: single signals genuinely appear by
 * accident, and the cost of a false "this is not a receipt" is a resident who
 * doubts a warning we gave them correctly last time.
 */
describe("looksLikePaymentReceipt", () => {
  it("recognises the receipts residents actually send", () => {
    for (const text of [
      esewa,
      "Khalti\nPayment Successful\nRs. 5,215.00",
      "Global IME Bank\nAmount 1290\nReference No: 99481203",
      "FonePay\nTransaction successful\nNPR 1,290",
      "भुक्तानी सफल\nरु १०,०००\nTransaction ID 88231194",
    ]) {
      expect(looksLikePaymentReceipt(text), text.slice(0, 24)).toBe(true);
    }
  });

  it("rejects the things that are not receipts", () => {
    for (const text of [
      "Happy Birthday Ramesh",
      "IMG_20260811_093512",
      "Hey did you pay the rent yet\nyeah just now\nok thanks",
      "",
    ]) {
      expect(looksLikePaymentReceipt(text), text.slice(0, 24)).toBe(false);
    }
  });

  it("does not call a single accidental signal a receipt", () => {
    // A chat where somebody typed an amount. One family only, so it does not pass
    // — this is the whole reason the floor is two.
    expect(looksLikePaymentReceipt("i will send Rs. 2000 tomorrow")).toBe(false);
    expect(receiptSignals("i will send Rs. 2000 tomorrow")).toEqual(["currency"]);
  });

  it("names which signals it found, so a decision can be explained", () => {
    expect(receiptSignals(esewa).sort()).toEqual([
      "currency",
      "provider",
      "vocabulary",
    ]);
  });
});

describe("evidenceTextFlags", () => {
  it("confirms when the image carries the amount and an id", () => {
    expect(evidenceTextFlags(esewa, facts)).toEqual([
      "EVIDENCE_TEXT_MATCHES_CLAIM",
    ]);
  });

  it("accepts the reference code in place of the transaction id", () => {
    // A bank transfer receipt shows the remark, not a wallet-style code. The
    // second flag marks the non-circular case: the code came from the invoice,
    // not from the image, so finding it there is a fact autofill cannot produce.
    expect(
      evidenceTextFlags("NPR 10000 transferred\nRemarks EDU-0001-F", facts),
    ).toEqual(["EVIDENCE_TEXT_MATCHES_CLAIM", "EVIDENCE_REFERENCE_ON_IMAGE"]);
  });

  it("reports the amount alone as missing", () => {
    // A receipt by its signals — provider and vocabulary — so the classifier
    // passes it and the specific miss is what gets reported.
    expect(
      evidenceTextFlags("eSewa\nPayment Successful\nTransaction Code 8823119471", facts),
    ).toEqual(["EVIDENCE_AMOUNT_NOT_ON_IMAGE"]);
  });

  it("reports the id alone as missing", () => {
    expect(evidenceTextFlags("Rs. 10,000.00 paid", facts)).toEqual([
      "EVIDENCE_ID_NOT_ON_IMAGE",
    ]);
  });

  it("says an image is not a payment record before saying it does not match", () => {
    // "The amount does not match" on a photo of a wall is technically true and no
    // help to anybody. This is the sentence a resident can act on.
    expect(evidenceTextFlags("Happy Birthday Ramesh", facts)).toEqual([
      "EVIDENCE_NOT_A_PAYMENT_RECORD",
    ]);
  });

  it("reports a real receipt that corresponds to nothing in the claim", () => {
    // A receipt by its vocabulary — so not the wrong *kind* of file — but for a
    // different payment. Most often last month's.
    expect(
      evidenceTextFlags(
        "eSewa\nPayment Successful\nRs. 500.00\nTransaction Code 1122334455",
        facts,
      ),
    ).toEqual(["EVIDENCE_NO_TEXT_FOUND"]);
  });

  it("confirms a rendered receipt end to end, engine included", async () => {
    // The one test that runs the real recogniser: WASM core, language model and
    // all. It is what proves the preprocessing, the tolerance and the matcher
    // agree with what the engine actually returns — the mocked tests above cannot.
    //
    // Skipped rather than failed if the engine cannot start, because a CI box
    // with no model file is an environment problem and not a broken claim
    // pipeline. The rest of this file still holds the behaviour.
    const canvas = createCanvas(720, 420);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 720, 420);
    ctx.fillStyle = "#111111";
    ctx.font = "bold 34px sans-serif";
    ctx.fillText("eSewa", 40, 70);
    ctx.font = "28px sans-serif";
    ctx.fillText("Payment Successful", 40, 130);
    ctx.fillText("Rs. 10,000.00", 40, 190);
    ctx.fillText("Transaction Code 8823119471", 40, 250);
    ctx.fillText("Remarks: EDU-0001-F", 40, 310);

    const text = await readEvidenceText(canvas.toBuffer("image/png"));

    if (text === null) return;

    expect(evidenceTextFlags(text, facts)).toContain("EVIDENCE_TEXT_MATCHES_CLAIM");

    // The same text through the autofill path: what the claim form would put in
    // front of the resident. The amount and method have to survive the round trip
    // through a real recogniser, not just through a hand-written fixture.
    const extracted = extractClaimFields(text);

    expect(extracted.amount).toBe(10000);
    expect(extracted.method).toBe("ESEWA");
  }, 60_000);

  /**
   * The lines eSewa's own `PAYMENT RECEIPT` export puts on the page, in its order
   * and with its punctuation — taken from a real `Send Money` PDF.
   *
   * Two things about this format broke the extraction and are the reason this test
   * exists: the id is labelled **`Reference Code`**, which no pattern matched, and
   * the amount is written **`Amount : 60.00` with no currency marker anywhere on
   * the page**, so every currency-anchored rule read nothing off it.
   */
  const ESEWA_PDF_LINES = [
    "Send Money",
    "PAYMENT RECEIPT",
    "Reference Code : 1NVX5KB Date : 2026-08-05 05:00 PM NPT",
    "Amount : 60.00 Channel : App",
    "Status : COMPLETE",
    "Purpose : Bill sharing",
    "Receiver Name : Aadarsh Yadav",
    "Payment Method : eSewa Wallet",
    "Request Unique Id : 1785928509668:18402204",
    "Remarks : EDU-0001-F",
  ];

  async function esewaPdf() {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    ESEWA_PDF_LINES.forEach((line, index) => {
      page.drawText(line, { font, size: 11, x: 40, y: 780 - index * 22 });
    });

    return Buffer.from(await pdf.save());
  }

  it("reads a PDF receipt through its text layer, exactly", async () => {
    // **A PDF is the easy case, and it used to be the abandoned one.** Its
    // characters are in the file as characters, so this needs no recogniser, no
    // shape folding and no one-substitution tolerance — and it takes ~150ms rather
    // than a second. Residents whose bank only issues PDFs were the ones getting
    // no autofill and an amber flag on every single claim.
    const text = await readEvidenceText(await esewaPdf(), "application/pdf");

    expect(text).not.toBeNull();
    expect(looksLikePaymentReceipt(text!)).toBe(true);

    expect(extractClaimFields(text!)).toEqual({
      amount: 60,
      method: "ESEWA",
      referenceCode: "EDU-0001-F",
      transactionCode: "1NVX5KB",
    });

    expect(
      evidenceTextFlags(text!, {
        amount: 60,
        referenceCode: "EDU-0001-F",
        transactionCode: "1NVX5KB",
      }),
    ).toEqual(["EVIDENCE_TEXT_MATCHES_CLAIM", "EVIDENCE_REFERENCE_ON_IMAGE"]);
  }, 30_000);

  it("does not mistake a PDF's own field labels for the transaction id", () => {
    // `Request Unique Id` sits two lines below `Reference Code` and is longer. The
    // label anchors are ordered so the receipt's actual reference wins.
    expect(extractClaimFields(ESEWA_PDF_LINES.join("\n")).transactionCode).toBe(
      "1NVX5KB",
    );
  });

  it("stays silent when there was no recognition to judge", () => {
    // Null is "unread", which the caller turns into
    // `EVIDENCE_NOT_MACHINE_CHECKED` — a different statement from "read and it
    // does not match", and the two must not collapse into one flag.
    expect(evidenceTextFlags(null, facts)).toEqual([]);
  });
});

/**
 * The refusal, and the band between it and the warning.
 *
 * `looksLikePaymentReceipt` is a warning and may be wrong; this one stops the
 * resident submitting, so every case here is about *not* firing on something a
 * hostel would have accepted.
 */
describe("isDefinitelyNotPaymentEvidence", () => {
  const notes =
    "Physics chapter 4 notes\nremember the second law and the pulley diagram from class";

  it("refuses a readable page with no trace of a payment on it", () => {
    expect(isDefinitelyNotPaymentEvidence(notes)).toBe(true);
  });

  it("never refuses a real receipt, however badly it read", () => {
    for (const text of [
      esewa,
      // One family only — warned about by `looksLikePaymentReceipt`, and that is
      // as far as it goes. A resident's real proof is never refused on this.
      "i will send Rs. 2000 tomorrow, the rest after the exam finishes ok",
      "Transaction successful, keep this for your records, thank you for using us",
    ]) {
      expect(isDefinitelyNotPaymentEvidence(text), text.slice(0, 24)).toBe(false);
    }
  });

  it("says nothing when there is not enough text to say it from", () => {
    // A dark or skewed photo yields a few stray characters. Zero signals in
    // twenty of them is a fact about the read, not about the file.
    expect(isDefinitelyNotPaymentEvidence("IMG_20260811_093512")).toBe(false);
    expect(isDefinitelyNotPaymentEvidence("")).toBe(false);
    expect(isDefinitelyNotPaymentEvidence(null)).toBe(false);
    // Whitespace does not buy its way over the floor.
    expect(isDefinitelyNotPaymentEvidence(`hello${"\n".repeat(60)}`)).toBe(false);
  });
});
