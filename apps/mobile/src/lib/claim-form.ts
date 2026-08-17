/**
 * What has to be true before a payment claim is worth sending.
 *
 * Its own module so it can be tested — Vitest here is node-side with no React
 * Native shim, so nothing importing a component can be.
 *
 * The rules mirror `claim.validation.ts` on the server rather than inventing
 * softer ones. That is the point: the submit endpoint is rate-limited to **8 an
 * hour** because every call runs OCR over a full-size screenshot, so a client
 * that lets an invalid claim through burns one of a resident's eight attempts
 * to be told something the phone already knew.
 */

export type ClaimDraft = {
  amount: string;
  proofAssetId: string | null;
  transactionCode: string;
};

export type ClaimErrors = Partial<Record<keyof ClaimDraft, string>>;

/** The server's `PAYMENT_METHODS`. No `CHEQUE`; `OTHER` is real. */
export const CLAIM_METHODS = [
  { label: "eSewa", value: "ESEWA" },
  { label: "Khalti", value: "KHALTI" },
  { label: "Fonepay", value: "FONEPAY" },
  { label: "Bank transfer", value: "BANK_TRANSFER" },
  { label: "Cash", value: "CASH" },
  { label: "Other", value: "OTHER" },
] as const;

/**
 * Whole rupees only.
 *
 * Not a formatting preference — whole rupees are the ledger's foundation
 * (ADR-1) and the server rejects a fractional claim at the boundary rather than
 * rounding one three layers down. Catching it here means the resident sees
 * "whole rupees" next to the field instead of a 422 after the upload.
 */
export function parseClaimAmount(raw: string): number | null {
  const cleaned = raw.replace(/[\s,]/g, "");

  if (!/^\d+$/.test(cleaned)) {
    return null;
  }

  const value = Number(cleaned);

  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function validateClaim(draft: ClaimDraft): ClaimErrors {
  const errors: ClaimErrors = {};

  if (!draft.amount.trim()) {
    errors.amount = "Enter the amount you paid.";
  } else if (parseClaimAmount(draft.amount) === null) {
    errors.amount = "Enter a whole rupee amount, with no paisa.";
  }

  if (!draft.proofAssetId) {
    // The screenshot is the whole claim. Without it there is nothing for the
    // hostel to check against their statement, and the server refuses it.
    errors.proofAssetId = "Attach a screenshot or photo of your payment.";
  }

  if (draft.transactionCode.trim().length > 120) {
    errors.transactionCode = "That transaction code is too long.";
  }

  return errors;
}

export function hasErrors(errors: ClaimErrors): boolean {
  return Object.keys(errors).length > 0;
}
