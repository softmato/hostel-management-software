import { describe, expect, it } from "vitest";

import {
  AUTO_METHOD,
  claimRejection,
  hasErrors,
  parseClaimAmount,
  resolveClaimMethod,
  transactionCodeProblem,
  transactionCodeRequired,
  uploadRejection,
  validateClaim,
  whereToLook,
} from "@/lib/claim-form";

function draft(overrides: Partial<Parameters<typeof validateClaim>[0]> = {}) {
  return {
    amount: "8500",
    method: "ESEWA",
    proofAssetId: "asset-1",
    transactionCode: "8823119471",
    ...overrides,
  };
}

/** The two calendar lookups `claimRejection` takes, stubbed to stay node-side. */
const describeDates = {
  day: (iso: string) => `day(${iso})`,
  month: (period: string) => `month(${period})`,
};

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
    expect(
      validateClaim(draft({ transactionCode: `88231${"1".repeat(116)}` })).transactionCode,
    ).toBeTruthy();
  });

  /*
   * The two rules that were costing a submit each. `TXN_ID_REQUIRED` and
   * `TXN_ID_NOT_PLAUSIBLE` are server refusals the phone can reach first, and
   * eight submits an hour is not a budget to spend on them.
   */
  it("requires the id for the four methods that issue one", () => {
    expect(validateClaim(draft({ transactionCode: "" })).transactionCode).toContain(
      "transaction ID",
    );
    expect(
      validateClaim(draft({ method: "BANK_TRANSFER", transactionCode: "" }))
        .transactionCode,
    ).toBeTruthy();
  });

  it("does not require one for cash or other — neither issues an id", () => {
    expect(
      validateClaim(draft({ method: "CASH", transactionCode: "" })).transactionCode,
    ).toBeUndefined();
    expect(
      validateClaim(draft({ method: "OTHER", transactionCode: "" })).transactionCode,
    ).toBeUndefined();
  });

  it("refuses a placeholder id before it costs a submit", () => {
    expect(validateClaim(draft({ transactionCode: "dummy" })).transactionCode).toBeTruthy();
    expect(validateClaim(draft({ transactionCode: "123456" })).transactionCode).toBeTruthy();
  });

  /*
   * For cash the same input is labelled "Who did you give the cash to?" and
   * holds a person's name, which fails every shape rule by design.
   */
  it("leaves a cash payee's name alone", () => {
    expect(
      validateClaim(draft({ method: "CASH", transactionCode: "Ramesh Shrestha" }))
        .transactionCode,
    ).toBeUndefined();
  });

  /*
   * `Auto` before a receipt has been read resolves to null, and demanding an id
   * for a payment whose kind we have not established is a red field nobody can
   * clear. The missing *method* is the error worth showing.
   */
  it("says nothing about the id while the method is still unknown", () => {
    const errors = validateClaim(draft({ method: null, transactionCode: "" }));

    expect(errors.method).toBeTruthy();
    expect(errors.transactionCode).toBeUndefined();
  });
});

describe("transactionCodeProblem", () => {
  it("accepts the references the providers actually issue", () => {
    expect(transactionCodeProblem("8823119471")).toBeNull();
    expect(transactionCodeProblem("FT26 0812 4471")).toBeNull();
    expect(transactionCodeProblem("TESTA9481203")).toBeNull();
  });

  it("refuses what cannot be an id", () => {
    expect(transactionCodeProblem("1234")).toContain("too short");
    expect(transactionCodeProblem("testing")).toContain("placeholder");
    expect(transactionCodeProblem("t-e-s-t-i-n-g")).toContain("placeholder");
    expect(transactionCodeProblem("aaaaaa")).toBeTruthy();
    expect(transactionCodeProblem("ABCDEF")).toBeTruthy();
    expect(transactionCodeProblem("PAYMENTMADE")).toContain("numbers");
  });

  /*
   * Nothing here can tell a *fabricated* id from a real one — only the provider
   * knows that. `DUMMY1` and `TEST1234` are refused by nothing above and reach
   * the owner's queue, which is correct: shape rules refuse the ids that cannot
   * possibly be real, and statement reconciliation is what refuses the ones that
   * merely are not. A rule tight enough to catch these would start refusing real
   * references the first time a bank added a character.
   */
  it("does not pretend to detect invention", () => {
    expect(transactionCodeProblem("DUMMY1")).toBeNull();
    expect(transactionCodeProblem("TEST1234")).toBeNull();
  });

  it("says nothing about an empty one — that is the required check's job", () => {
    expect(transactionCodeProblem("")).toBeNull();
    expect(transactionCodeProblem(null)).toBeNull();
  });
});

describe("transactionCodeRequired", () => {
  it("covers exactly the four methods that hand the payer a reference", () => {
    expect(transactionCodeRequired("ESEWA")).toBe(true);
    expect(transactionCodeRequired("KHALTI")).toBe(true);
    expect(transactionCodeRequired("FONEPAY")).toBe(true);
    expect(transactionCodeRequired("BANK_TRANSFER")).toBe(true);
    expect(transactionCodeRequired("CASH")).toBe(false);
    expect(transactionCodeRequired("OTHER")).toBe(false);
    expect(transactionCodeRequired(null)).toBe(false);
  });
});

describe("resolveClaimMethod", () => {
  it("takes the resident's choice over anything read", () => {
    expect(resolveClaimMethod("KHALTI", "ESEWA")).toBe("KHALTI");
  });

  it("takes the receipt's answer under Auto", () => {
    expect(resolveClaimMethod(AUTO_METHOD, "ESEWA")).toBe("ESEWA");
  });

  /*
   * An honest "we do not know", which the screen asks about rather than
   * guessing. The old default was `ESEWA`, so a resident who uploaded a bank
   * receipt and never opened the picker declared a wallet payment they had not
   * made.
   */
  it("is null under Auto with nothing read", () => {
    expect(resolveClaimMethod(AUTO_METHOD, null)).toBeNull();
  });

  /*
   * A value outside the six would be refused at the boundary, and being refused
   * for a method nobody chose is the least explicable rejection on the screen.
   */
  it("discards a detected value the server would not accept", () => {
    expect(resolveClaimMethod(AUTO_METHOD, "IME_PAY")).toBeNull();
  });
});

describe("whereToLook", () => {
  it("has steps for every method that issues an id", () => {
    for (const method of ["ESEWA", "KHALTI", "FONEPAY", "BANK_TRANSFER"]) {
      expect(whereToLook(method).length).toBeGreaterThan(0);
    }
  });

  it("falls back to the generic steps for cash and for no method at all", () => {
    expect(whereToLook("CASH")).toEqual(whereToLook(null));
  });
});

describe("claimRejection", () => {
  it("names what the screenshot collided with, and when", () => {
    const rejection = claimRejection(
      "EVIDENCE_ALREADY_USED",
      "This screenshot has already been submitted.",
      { priorPeriod: "2083-04", priorSubmittedAt: "2026-08-02T00:00:00.000Z" },
      describeDates,
    );

    expect(rejection?.title).toBe("This screenshot was already used");
    expect(rejection?.detail).toContain("day(2026-08-02T00:00:00.000Z)");
    expect(rejection?.detail).toContain("month(2083-04)");
  });

  it("still says something useful with no details attached", () => {
    const rejection = claimRejection(
      "EVIDENCE_ALREADY_USED",
      "already submitted",
      null,
      describeDates,
    );

    expect(rejection?.detail).toContain("It was already submitted.");
  });

  it("quotes the server for the refusals that name the resident's own file", () => {
    expect(
      claimRejection(
        "EVIDENCE_WRONG_TRANSACTION",
        "That receipt shows money arriving in your account.",
        null,
        describeDates,
      )?.detail,
    ).toBe("That receipt shows money arriving in your account.");

    expect(
      claimRejection(
        "EVIDENCE_IS_SYSTEM_DOCUMENT",
        "That is a receipt your hostel issued.",
        null,
        describeDates,
      )?.title,
    ).toBe("That is a receipt we issued");
  });

  it("names the id that was already recorded", () => {
    const rejection = claimRejection(
      "TXN_ID_ALREADY_CLAIMED",
      "already recorded",
      { priorPeriod: "2083-04", transactionCode: "8823119471" },
      describeDates,
    );

    expect(rejection?.detail).toContain("8823119471");
    expect(rejection?.detail).toContain("month(2083-04)");
  });

  /*
   * A rate limit, a network failure, a 500. These belong in a toast on a form
   * the resident can submit again — not in a card that clears their upload.
   */
  it("is null for an ordinary failure", () => {
    expect(claimRejection("RATE_LIMITED", "Too many claims.", null, describeDates)).toBeNull();
    expect(claimRejection(null, "Network error", null, describeDates)).toBeNull();
  });
});

/**
 * The upload leg's refusals.
 *
 * The split that matters is which codes return a notice and which return null:
 * a file that is wrong stays on screen, a connection that dropped does not.
 * Getting that backwards either hides the reason a photo keeps failing, or tells
 * a resident to find a different file when the one they have is fine.
 */
describe("uploadRejection", () => {
  it("names an undecodable image and suggests a way round it", () => {
    const rejection = uploadRejection("UPLOAD_IMAGE_UNDECODABLE", "whatever");

    expect(rejection?.title).toBe("That image could not be opened");
    expect(rejection?.detail).toContain("PDF");
  });

  it("says which formats are accepted when the type is wrong", () => {
    const rejection = uploadRejection("UPLOAD_TYPE_MISMATCH", "whatever");

    expect(rejection?.title).toBe("That kind of file is not supported");
    expect(rejection?.detail).toMatch(/JPEG, PNG or WebP/);
  });

  it("treats a mismatched upload as something to attach again", () => {
    expect(uploadRejection("UPLOAD_SIZE_MISMATCH", "x")?.title).toBe(
      "That upload did not arrive intact",
    );
    expect(uploadRejection("UPLOAD_CONTENT_MISMATCH", "x")?.title).toBe(
      "That upload did not arrive intact",
    );
  });

  it("carries the server's sentence for an upload that never landed", () => {
    const rejection = uploadRejection("UPLOAD_NOT_FOUND", "We never received it.");

    expect(rejection?.detail).toBe("We never received it. Please attach it again.");
  });

  it("leaves transient failures to the toaster", () => {
    // Null on purpose: a dropped connection is over once it is read, and a
    // permanent notice about it would send the resident hunting for a different
    // file they do not need.
    expect(uploadRejection(null, "Network error")).toBeNull();
    expect(uploadRejection("RATE_LIMITED", "Slow down")).toBeNull();
  });
});

describe("uploadRejection — presign refusals", () => {
  it("does not repeat the server's raw byte count at the resident", () => {
    const rejection = uploadRejection(
      "FILE_TYPE_NOT_ALLOWED",
      "Image exceeds the 10485760 byte upload limit.",
    );

    expect(rejection?.title).toBe("That file cannot be uploaded");
    expect(rejection?.detail).not.toMatch(/\d{5,}|byte/);
    // One code, both causes — so the copy has to cover both.
    expect(rejection?.detail).toMatch(/JPEG, PNG or WebP/);
    expect(rejection?.detail).toMatch(/large photo/);
  });
});
