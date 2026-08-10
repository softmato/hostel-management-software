/**
 * Finance error vocabulary (plan §5.1).
 *
 * Extends the existing `PaymentServiceError` shape (message, `errorCode`,
 * `status`) rather than inventing a new one, so route error handling is
 * unchanged. Codes are stable and SCREAMING_SNAKE: the resident UI and the
 * mobile app branch on them, so renaming one is a breaking change.
 */

export const FINANCE_ERROR_STATUS = {
  /** No schedule covers the billing period (target §3.4). */
  FEE_SCHEDULE_MISSING: 422,
  /** The schedule has no rate for this resident's bed type. */
  BED_TYPE_NOT_PRICED: 422,
  /** A non-void invoice already exists for the period. */
  INVOICE_ALREADY_BILLED: 409,
  /** No such invoice **that this principal may see** — same answer either way. */
  INVOICE_NOT_FOUND: 404,
  /** Nothing left to claim against; the invoice is settled. */
  INVOICE_ALREADY_PAID: 409,
  /** No such claim, or not one this principal may review. */
  CLAIM_NOT_FOUND: 404,
  /** Somebody else approved or rejected it first. */
  CLAIM_ALREADY_REVIEWED: 409,
  /**
   * Voiding would orphan money that is really in the hostel's account. Reverse
   * the payments first — that path notifies the resident and stays on the ledger.
   */
  INVOICE_HAS_SETTLED_PAYMENTS: 409,
  /** The reference code's check character does not verify (target §5.1). */
  REFERENCE_CODE_INVALID: 422,
  /**
   * The hostel has no `referencePrefix`, so no invoice it issues could carry a
   * code. A data gap the Block 1 backfill closes — billing stops rather than
   * issuing invoices that can never be matched to a payment.
   */
  REFERENCE_PREFIX_MISSING: 422,
  /** The same evidence hash was already used in this hostel (target §8.1). */
  EVIDENCE_ALREADY_USED: 409,
  /** `{hostelId, provider, providerTxnId}` collides. */
  TXN_ID_ALREADY_USED: 409,
  /** The asset does not belong to the submitting resident (target §13.2). */
  ASSET_NOT_OWNED: 403,
  /** The asset's upload was never verified (target §13.3). */
  ASSET_UPLOAD_INCOMPLETE: 422,
  /** At or below zero, or beyond outstanding × 1.5 (target §6.2 step 5d). */
  AMOUNT_OUT_OF_BOUNDS: 422,
  /**
   * A reversal arrived without a usable reason (target §9.3). Its own code
   * rather than `AMOUNT_OUT_OF_BOUNDS`, which is about money: a screen that
   * branches on the latter would tell the user to fix an amount they never
   * typed.
   */
  REVERSAL_REASON_REQUIRED: 422,
  /**
   * A settled event's financial field was written. Never user-facing — reaching
   * this means a code path exists that should not (ADR-2).
   */
  SETTLED_EVENT_IMMUTABLE: 500,
  /** A receipt cannot be voided twice — the second call has nothing to undo. */
  RECEIPT_ALREADY_VOID: 409,
  /**
   * No receipt with that id **that this principal may read**. Out-of-scope and
   * non-existent are the same answer on purpose (RULES.md §3).
   */
  RECEIPT_NOT_FOUND: 404,
  /** Cash above the hostel's threshold with only one approver (target §9.1). */
  SECOND_APPROVER_REQUIRED: 409,
  /** A multi-hostel actor did not say which hostel. Existing code, reused. */
  HOSTEL_SCOPE_REQUIRED: 422,
  /**
   * No parser recognised the uploaded file, or a recognised one hit a row it
   * could not read. Deliberately fatal for the whole import (target §6.4): a
   * statement read 60 rows of 84 and said nothing looks exactly like 24
   * residents who did not pay.
   */
  STATEMENT_UNREADABLE: 422,
  /** No such statement import, or not one this principal may see. */
  STATEMENT_NOT_FOUND: 404,
  /** The import is still parsing, or failed, so it has no buckets to show. */
  STATEMENT_NOT_READY: 409,
  /** No such payment event, or not one this principal may act on. */
  EVENT_NOT_FOUND: 404,
  /** Assigning an orphan credit that is not, in fact, unassigned. */
  EVENT_ALREADY_ASSIGNED: 409,
  /**
   * The hostel's Tier 1 gateway is not usable — no merchant code, not enabled,
   * or a missing signing key. Never falls back to sandbox: a live QR signed with
   * a test key sends a resident's money to the wrong merchant.
   */
  GATEWAY_NOT_CONFIGURED: 422,
  /**
   * The entry exists but may not take online payments — a personal wallet, or a
   * merchant entry with no merchant code. Distinct from `NOT_CONFIGURED` because
   * the fix is different: this one cannot be fixed by finishing the form.
   */
  GATEWAY_NOT_ELIGIBLE: 422,
  /**
   * A sandbox-mode entry was reached in production. Sandbox entries are hidden
   * from residents there, so this is a direct hit on the intent route rather
   * than something a resident can walk into.
   */
  GATEWAY_SANDBOX_IN_PRODUCTION: 409,
  /**
   * The provider was asked and did not agree — a verification that came back
   * `FAILED`, or one whose amount disagrees with the invoice. Never settles.
   */
  GATEWAY_VERIFICATION_FAILED: 422,
  /** The provider could not be reached, or answered in a shape we cannot read. */
  GATEWAY_UNREACHABLE: 502,
  /** No such payment attempt, or not one this principal may see. */
  INTENT_NOT_FOUND: 404,
  /** The attempt has expired, been paid, or otherwise left the payable state. */
  INTENT_NOT_PAYABLE: 409,
} as const;

export type FinanceErrorCode = keyof typeof FINANCE_ERROR_STATUS;

export class FinanceServiceError extends Error {
  errorCode: string;
  status: number;

  constructor(message: string, errorCode: FinanceErrorCode) {
    super(message);
    this.name = "FinanceServiceError";
    this.errorCode = errorCode;
    this.status = FINANCE_ERROR_STATUS[errorCode];
  }
}
