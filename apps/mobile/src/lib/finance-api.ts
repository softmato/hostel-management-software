/**
 * Resident finance, typed against the endpoints that actually exist.
 *
 * ⚠️ The pre-2026-08 mobile client called `GET /resident/payments` and
 * `POST /resident/payments/{id}/proof`. **Both routes are gone.** Finance was
 * rebuilt around invoices, claims and a gateway checkout, and the old paths
 * 404 — which is why the previous app's payments tab could never have worked.
 *
 * The current surface, all under `/api/v1/resident/finance`:
 *
 *   GET  /invoices                        every invoice + open claims + credit
 *   GET  /invoices/{id}/pay-instructions  where and how to pay this one
 *   POST /invoices/{id}/claims            "I have paid" + evidence
 *   POST /invoices/{id}/checkout          start an eSewa/Khalti/Fonepay handoff
 *   GET  /receipts/{id}/pdf               a settled payment's receipt
 *   GET  /statement/pdf                   the full statement
 *   GET  /checkout/{reference}            poll one checkout attempt
 *
 * Shapes mirror `apps/web/src/modules/finance/invoice-list.service.ts`. If one
 * changes there, it changes here — there is no shared package between the two
 * yet, so this file is the seam.
 */

import { API_BASE_URL, api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";

/** Matches `PortalInvoice & { receipts, referenceCode }`. */
export type ResidentInvoice = {
  dueAmount: number;
  dueDate?: string;
  id: string;
  method?: string;
  month: string;
  paidAmount: number;
  paidDate?: string;
  receipts: { amount: number; id: string; issuedAt: string | null; number: string }[];
  /**
   * The code to put in the bank transfer's remarks. Shown on the list, not just
   * behind "Pay now" — a resident paying from their banking app out of habit
   * never opens that screen, and a payment with no code has to be matched by hand.
   */
  referenceCode: string | null;
  status: string;
};

export type ResidentClaim = {
  amount: number;
  createdAt?: string;
  id: string;
  invoiceId?: string;
  status: string;
};

export type ResidentFinanceView = {
  claims: ResidentClaim[];
  /** Carried from an overpayment. Usually 0; show it only when it is not. */
  credit: number;
  invoices: ResidentInvoice[];
};

export type PayInstructions = {
  bankAccounts?: {
    accountName?: string;
    accountNumber?: string;
    bankName?: string;
    branch?: string;
  }[];
  note?: string;
  qrAssetId?: string | null;
  referenceCode?: string | null;
  wallets?: { label?: string; number?: string; provider?: string }[];
};

export type PaymentMethod =
  | "BANK_TRANSFER"
  | "CASH"
  | "CHEQUE"
  | "ESEWA"
  | "FONEPAY"
  | "KHALTI";

export type GatewayProvider = "ESEWA" | "FONEPAY" | "KHALTI";

export async function getFinanceView() {
  const response = await api.get<ApiEnvelope<ResidentFinanceView>>(
    "/resident/finance/invoices",
  );

  return unwrap(response);
}

export async function getPayInstructions(invoiceId: string) {
  const response = await api.get<ApiEnvelope<PayInstructions>>(
    `/resident/finance/invoices/${invoiceId}/pay-instructions`,
  );

  return unwrap(response);
}

/**
 * Submit a payment claim.
 *
 * `proofImageAssetId` comes from the upload pipeline in `lib/uploads.ts` — the
 * server validates the asset is real, unused and owned by the caller, so a
 * fabricated id is refused rather than trusted.
 *
 * The server is idempotent here: a replayed submit collapses onto the existing
 * claim and comes back `created: false` with a 200 instead of a second 201. Show
 * that as "already submitted", not as a fresh success.
 */
export async function submitClaim(
  invoiceId: string,
  input: {
    amount: number;
    paidAt?: string;
    paymentMethod: PaymentMethod;
    proofImageAssetId: string;
    referenceNote?: string;
    transactionCode?: string;
  },
) {
  const response = await api.post<ApiEnvelope<{ created: boolean; claimId?: string }>>(
    `/resident/finance/invoices/${invoiceId}/claims`,
    input,
  );

  return unwrap(response);
}

/**
 * Start a gateway checkout.
 *
 * The response is a *handoff*, never a settlement — a URL to open, a form to
 * post, a QR to render. The money is not on the ledger until the provider has
 * been asked directly and agreed, so the app must poll `getCheckoutStatus`
 * rather than assume success when the browser returns.
 */
export async function startCheckout(invoiceId: string, provider: GatewayProvider) {
  const response = await api.post<
    ApiEnvelope<{
      fields?: Record<string, string>;
      method?: "GET" | "POST";
      reference: string;
      url?: string;
    }>
  >(`/resident/finance/invoices/${invoiceId}/checkout`, { provider });

  return unwrap(response);
}

export async function getCheckoutStatus(reference: string) {
  const response = await api.get<ApiEnvelope<{ status: string }>>(
    `/resident/finance/checkout/${reference}`,
  );

  return unwrap(response);
}

/**
 * PDFs are streamed with the bearer token, so they cannot be handed to a plain
 * `<Linking.openURL>` — these return the absolute URL, and the caller downloads
 * with the auth header via `expo-file-system` before sharing.
 */
export function receiptPdfUrl(receiptId: string) {
  return `${API_BASE_URL}/api/v1/resident/finance/receipts/${receiptId}/pdf`;
}

export function statementPdfUrl() {
  return `${API_BASE_URL}/api/v1/resident/finance/statement/pdf`;
}
