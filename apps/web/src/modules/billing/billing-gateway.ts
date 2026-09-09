import "server-only";

import { siteUrl } from "@/lib/site";
import { openSoftmatoCheckout } from "@/modules/billing/softmato/checkout";
import {
  fetchInvoiceDetail,
  fetchReceiptDetail,
} from "@/modules/billing/softmato/documents";
import {
  ensureSoftmatoInvoice,
  type EnsureInvoiceInput,
} from "@/modules/billing/softmato/invoice";

/**
 * The seam where the platform's own billing meets Softmato, and the only file
 * that knows their name.
 *
 * This used to mock two things — document rendering and a Fonepay handshake —
 * behind the promise that swapping them would be an edit to this file and
 * nothing else. That promise is now cashed: both are real, and the shape of
 * the swap was not the one the mock anticipated.
 *
 * ## Softmato does not render our invoice; it *raises* it
 *
 * The mock assumed a renderer: hand it a number we allocated and get a PDF
 * back. What actually arrived owns more than that. Softmato issues the invoice
 * number, keeps the ledger, produces the document, and emails the receipt —
 * under its own name and PAN. We own who the customer is, what plan they
 * bought, and turning the service on once we are told money arrived.
 *
 * So two numbers exist for one obligation and both are kept: ours
 * (`SUB-2609-0001-4F2A`) is the handle our screens and emails quote, theirs
 * (`INV-2083/84-000010`) is the one on the statutory document. `external_ref`
 * links them and is derived from ours, so there is nothing to keep in sync.
 *
 * ## What stays off the rail, and why that is not a gap
 *
 * **Cash does.** An agent taking notes in the field is money that no gateway
 * can corroborate, and there is no endpoint that would let us assert
 * otherwise. Recording it as a Softmato transaction would put a row in their
 * ledger that nothing backs. So a cash payment keeps our own receipt number
 * and carries no Softmato transaction — honest about being our record rather
 * than their document.
 *
 * **Resident rent does too**, one level down, and that one is a rule rather
 * than a limitation: on that flow the *hostel* is the merchant of record, and
 * Softmato's invoices carry Softmato's PAN. Nothing in `modules/finance`
 * touches this file.
 *
 * ## The document link is ours, not theirs
 *
 * `InvoiceDetail.document_url` is an API address that needs our client secret
 * in an `Authorization` header. Emailing it to an owner would be handing them
 * a link that 401s. So what we store and send is a route on *this* app, which
 * authenticates the reader as someone entitled to that hostel's paperwork and
 * then streams the bytes.
 */

export type { EnsureInvoiceInput };

export interface IssuedInvoice {
  /** Our own authenticated download route. Never Softmato's API address. */
  documentUrl: string;
  softmatoInvoiceId: string;
  softmatoInvoiceNo: string;
}

/**
 * Raises the invoice on Softmato, or returns the one already raised for it.
 *
 * Safe to call again for the same `invoiceNumber` — that is the mechanism, not
 * a tolerance. `external_ref` is unique per application and a repeat returns
 * the existing invoice, so a double-clicked Pay now, a retried job and a crash
 * between our write and theirs all converge on one demand for money.
 */
export async function issueInvoiceDocument(
  input: EnsureInvoiceInput,
): Promise<IssuedInvoice> {
  const invoice = await ensureSoftmatoInvoice(input);

  /*
   * **`invoice_id` is the invoice number.** Verified against a live deployment
   * on 2026-09-09: `POST /v1/invoices` answers with `invoice_id:
   * "INV-2083/84-000014"` and no `invoice_no` field at all, even though the
   * SDK's `Invoice` type declares both and `INTEGRATION.md` §2.1 shows a
   * response carrying an opaque numeric id beside a separate number.
   *
   * That is one identifier wearing two names, and the same string is what
   * `POST /v1/checkout` is addressed by, what `GET /v1/invoices/{…}` resolves,
   * and what a webhook's own `invoice_id` carries. So both columns are filled
   * from it, `invoice_no` is preferred if a deployment ever does send one, and
   * nothing downstream has to know which of the two it was given.
   */
  const number = invoice.invoice_no ?? invoice.invoice_id;

  return {
    documentUrl: documentDownloadUrl("invoice", input.invoiceNumber),
    softmatoInvoiceId: invoice.invoice_id,
    softmatoInvoiceNo: number,
  };
}

export interface OpenedCheckout {
  /** `esewa`, `khalti` — what the payer will be offered. */
  allowedProviders: string[];
  checkoutUrl: string;
  /** 30 minutes out. A session is a cheque, not a link. */
  expiresAt: string;
  sessionId: string;
}

export async function openCheckoutSession(input: {
  invoiceNumber: string;
  softmatoInvoiceId: string;
}): Promise<OpenedCheckout> {
  const session = await openSoftmatoCheckout(input);

  return {
    allowedProviders: session.allowed_providers,
    checkoutUrl: session.checkout_url,
    expiresAt: session.expires_at,
    sessionId: session.session_id,
  };
}

export interface SettledReceipt {
  /** Whole rupees received, gross. */
  amount: number;
  documentUrl: string;
  paidAt: Date;
  /** `eSewa` — the display name, as the receipt reports it. */
  provider: string;
  /** The gateway's own reference, for the owner's own reconciliation. */
  providerRef: string | null;
}

/**
 * The receipt for a settled payment.
 *
 * Softmato has already emailed this to the owner with the PDF attached — it is
 * the one message they send a customer, and they send it after money arrives,
 * never before. This read is for putting the same document in the owner's own
 * billing screen.
 *
 * `null` when there is no receipt, which is a real answer: a payment that has
 * not succeeded has none, because a receipt for money that has not arrived
 * would assert something untrue.
 */
export async function readSettledReceipt(
  transactionNo: string,
): Promise<SettledReceipt | null> {
  const receipt = await fetchReceiptDetail(transactionNo);

  if (!receipt) return null;

  return {
    amount: Math.round(receipt.amount_minor / 100),
    documentUrl: documentDownloadUrl("receipt", transactionNo),
    paidAt: new Date(receipt.paid_at),
    provider: receipt.provider,
    providerRef: receipt.provider_ref,
  };
}

export { fetchInvoiceDetail, fetchReceiptDetail };

/**
 * Where the owner downloads a document from — on this app, behind this app's
 * session.
 *
 * A document number contains a slash (`TXN-2083/84-00000008`), which is a path
 * separator here as much as anywhere, so it is encoded into a single segment.
 * Invoice numbers are our own and carry no slash, but they go through the same
 * function so there is one rule rather than two.
 */
export function documentDownloadUrl(
  kind: "invoice" | "receipt",
  number: string,
): string {
  return `${siteUrl()}/api/v1/hostel-admin/billing/documents/${kind}/${encodeURIComponent(number)}`;
}

/**
 * The integration guide Softmato hosts, linked from our own billing screen.
 *
 * Derived from `SOFTMATO_BASE_URL` rather than hardcoded, so a deployment
 * pointed at a local or staging Softmato links to *that* deployment's docs
 * instead of sending a developer to production to read about the sandbox they
 * are actually on.
 */
export function softmatoDocsUrl(): string | null {
  const base = process.env.SOFTMATO_BASE_URL?.trim();

  if (!base) return null;

  try {
    return new URL("/developers", base).toString();
  } catch {
    return null;
  }
}
