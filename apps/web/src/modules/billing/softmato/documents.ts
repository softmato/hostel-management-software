import "server-only";

import {
  SoftmatoApiError,
  type DocumentFile,
  type InvoiceDetail,
  type ReceiptDetail,
} from "@softmato/sdk";

import { softmato } from "./client";

/**
 * The documents themselves — read back for our own screens, and downloaded for
 * our own emails.
 *
 * Softmato emails the receipt with its PDF attached the moment money lands, so
 * nothing here is required for the customer to *get* their paperwork. This is
 * for putting the same history in the owner's own billing screen, and for
 * attaching the invoice to the notices we send before a payment — the ones
 * Softmato deliberately does not send, because it is our customer and our tone
 * of voice.
 *
 * ## Check the content type before you name the file
 *
 * A deployment with no PDF engine answers with a complete, printable HTML
 * rendering and a header saying so. It is a real document — it is just not a
 * PDF, and saving it as `invoice.pdf` hands the owner a file their reader
 * refuses to open. `documentFilename` below is the only place that decides an
 * extension, and it decides it from the bytes we actually received.
 *
 * ## Not found is a real answer
 *
 * A receipt exists only for a payment that succeeded — a receipt for money
 * that has not arrived would be a document asserting something untrue. So
 * `null` here means "no such document for this application", which is also
 * what an invoice belonging to somebody else returns. The two are
 * indistinguishable on purpose.
 */

async function orNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof SoftmatoApiError &&
      error.code === "RESOURCE_NOT_FOUND"
    ) {
      return null;
    }

    throw error;
  }
}

/** `INV-2083/84-000010` — the slash is a path separator, not an escape. */
export function fetchInvoiceDetail(
  invoiceNo: string,
): Promise<InvoiceDetail | null> {
  return orNull(() => softmato().getInvoice(invoiceNo));
}

/** `TXN-2083/84-00000008`. */
export function fetchReceiptDetail(
  transactionNo: string,
): Promise<ReceiptDetail | null> {
  return orNull(() => softmato().getReceipt(transactionNo));
}

export function downloadInvoiceFile(
  invoiceNo: string,
): Promise<DocumentFile | null> {
  return orNull(() => softmato().downloadDocument({ invoice: invoiceNo }, "pdf"));
}

export function downloadReceiptFile(
  transactionNo: string,
): Promise<DocumentFile | null> {
  return orNull(() =>
    softmato().downloadDocument({ receipt: transactionNo }, "pdf"),
  );
}

/**
 * A filename that matches what is actually in the bytes.
 *
 * The document number carries a slash — `INV-2083/84-000010` — which is a
 * directory separator on every filesystem the owner might save it to, so it is
 * flattened to a dash here rather than left to the browser to mangle.
 */
export function documentFilename(
  documentNumber: string,
  file: Pick<DocumentFile, "contentType" | "pdfFallbackReason">,
): string {
  const stem = documentNumber.replace(/\//g, "-");
  const extension = file.contentType === "application/pdf" ? "pdf" : "html";

  return `${stem}.${extension}`;
}

/**
 * Whether the file we got back is the PDF we asked for.
 *
 * Worth logging when false: the fallback is announced rather than silent so
 * that a deployment quietly serving HTML to every customer is visible in the
 * logs before it is visible in a support thread.
 */
export function isPdf(file: DocumentFile): boolean {
  return file.contentType === "application/pdf";
}
