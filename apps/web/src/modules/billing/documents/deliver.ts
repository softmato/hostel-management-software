import "server-only";

import { Types } from "mongoose";

import { SubscriptionInvoiceModel } from "@hostel/db/models/SubscriptionInvoice";
import { SubscriptionPaymentModel } from "@hostel/db/models/SubscriptionPayment";

import { connectToDatabase } from "@/lib/db";
import { isSoftmatoConfigured } from "@/modules/billing/softmato/config";
import {
  documentFilename as softmatoFilename,
  downloadInvoiceFile,
  downloadReceiptFile,
  isPdf,
} from "@/modules/billing/softmato/documents";

import {
  documentFileName,
  ensureLocalInvoiceNumber,
  ensureLocalReceiptNumber,
  renderInvoiceForRow,
  renderReceiptForRow,
} from "./issue";

/**
 * One call for "give me this document", whoever issued it.
 *
 * Every reader of a plan invoice or receipt — the owner's billing screen, the
 * superadmin's ledger, the email that carries the PDF — comes through here, so
 * that the question of *who printed this* is answered in one place instead of
 * at each call site. A screen that had to ask whether Softmato was up before it
 * could offer a download would be a screen that stops working when they go
 * down, which is the exact situation this exists for.
 *
 * ## Theirs first, ours as the answer rather than the apology
 *
 * When Softmato raised the invoice, their PDF is the document: it is in their
 * ledger, under their PAN, and it is the one the payment was actually recorded
 * against. When they did not — unconfigured, unreachable, or the raise failed
 * and the retry has not landed — we print it, and it is a real document rather
 * than a placeholder. The reader is never shown an error for a document that
 * exists; they are shown the document.
 *
 * The fallback is also taken when their API *is* configured and simply fails to
 * answer. A download is a read: retrying it later costs nothing and duplicates
 * nothing, so there is no reason to fail a reader over a timeout when the same
 * page can be produced from rows we already hold.
 *
 * ## Tenancy is enforced here, not by them
 *
 * Every hostel on this platform shares one Softmato credential, so to their API
 * one hostel asking for another's receipt is the same application asking for
 * its own. `hostelIds` is the only check there is. Passing `null` means the
 * caller is the platform, which is entitled to any of them — and that is
 * spelled as an explicit `null` rather than an omitted argument so nobody
 * reaches it by forgetting to pass a scope.
 */

export type ResolvedDocument = {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  /** Which side printed the bytes. Worth logging; never shown to a reader. */
  issuedBy: "softmato" | "platform";
};

/** `null` scope = the platform, entitled to every hostel's paperwork. */
export type HostelScope = string[] | null;

function scopeFilter(scope: HostelScope): Record<string, unknown> {
  if (scope === null) return {};

  return {
    hostelId: { $in: scope.map((id) => new Types.ObjectId(id)) },
  };
}

/**
 * Their bytes, or nothing, and never an exception.
 *
 * A download that throws would take a reader's billing screen down because a
 * third party was slow. The failure is logged loudly enough to be found — a
 * deployment silently serving its own documents for every customer is worth
 * knowing about — and then the caller falls through to rendering ours.
 */
async function trySoftmato(
  read: () => Promise<Awaited<ReturnType<typeof downloadInvoiceFile>>>,
  documentNumber: string,
): Promise<ResolvedDocument | null> {
  if (!isSoftmatoConfigured()) return null;

  try {
    const file = await read();

    if (!file) return null;

    /*
     * Their PDF, or ours — never their HTML.
     *
     * A Softmato deployment with no PDF engine answers a PDF request with a
     * printable HTML page. That is a real document, but it is not what an owner
     * was promised: it went out as `INV-….html` on the invoice email while the
     * receipt beside it — rendered here — arrived as a PDF, and the phone saved
     * the same HTML under a `.pdf` name its reader refused to open. We can always
     * print a PDF from our own rows, so an HTML answer is treated exactly like
     * no answer.
     */
    if (!isPdf(file)) {
      console.warn(
        JSON.stringify({
          action: "softmato_document_not_pdf",
          contentType: file.contentType,
          documentNumber,
          level: "warn",
          reason: file.pdfFallbackReason ?? null,
        }),
      );

      return null;
    }

    return {
      bytes: new Uint8Array(file.bytes),
      contentType: file.contentType,
      filename: softmatoFilename(documentNumber, file),
      issuedBy: "softmato",
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        action: "softmato_document_unavailable",
        documentNumber,
        level: "warn",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );

    return null;
  }
}

/* ── Invoice ───────────────────────────────────────────────────────────── */

/**
 * `invoiceNumber` is **ours** — `SUB-0001-4F2A`.
 *
 * The URL carries our number rather than the one printed on the page, because
 * ours exists from the moment the obligation does and the printed one may not
 * exist yet. A link built from the printed number would 404 for exactly the
 * invoices this fallback is for.
 */
export async function resolveInvoiceDocument(
  invoiceNumber: string,
  scope: HostelScope,
): Promise<ResolvedDocument | null> {
  await connectToDatabase();

  const invoice = await SubscriptionInvoiceModel.findOne({
    ...scopeFilter(scope),
    invoiceNumber,
  }).lean<Parameters<typeof renderInvoiceForRow>[0] | null>();

  if (!invoice) return null;

  if (invoice.softmatoInvoiceNo) {
    const theirs = await trySoftmato(
      () => downloadInvoiceFile(invoice.softmatoInvoiceNo as string),
      invoice.softmatoInvoiceNo,
    );

    if (theirs) return theirs;
  }

  const documentNumber =
    invoice.localInvoiceNo ?? (await ensureLocalInvoiceNumber(invoice._id));

  if (!documentNumber) return null;

  const paid = await settledTotal(invoice._id);
  const bytes = await renderInvoiceForRow(
    { ...invoice, localInvoiceNo: documentNumber },
    { amountPaid: paid, documentNumber },
  );

  return {
    bytes,
    contentType: "application/pdf",
    filename: documentFileName(documentNumber),
    issuedBy: "platform",
  };
}

/**
 * Everything actually collected against one invoice.
 *
 * `SETTLED` only, for the reason it is only ever `SETTLED` anywhere money is
 * counted in this codebase: a pending attempt is a promise being waited on, and
 * printing one on an invoice would show an owner a debt they have not cleared
 * as cleared.
 */
async function settledTotal(invoiceId: Types.ObjectId): Promise<number> {
  const rows = await SubscriptionPaymentModel.aggregate<{ total: number }>([
    { $match: { invoiceId, status: "SETTLED" } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  return rows[0]?.total ?? 0;
}

/* ── Receipt ───────────────────────────────────────────────────────────── */

/**
 * A receipt is addressed by whichever number the reader is holding.
 *
 * Three can identify one payment and all three are accepted: Softmato's
 * transaction number, our own statutory number, and the per-hostel receipt
 * reference support quotes. A reader holding a document should be able to fetch
 * it with the number printed on it, and which number that is depends on which
 * side printed the copy they have.
 */
export async function resolveReceiptDocument(
  number: string,
  scope: HostelScope,
): Promise<ResolvedDocument | null> {
  await connectToDatabase();

  const payment = await SubscriptionPaymentModel.findOne({
    ...scopeFilter(scope),
    $or: [
      { softmatoTransactionNo: number },
      { localTransactionNo: number },
      { receiptNumber: number },
    ],
  }).lean<Parameters<typeof renderReceiptForRow>[0] | null>();

  if (!payment || payment.status !== "SETTLED") return null;

  if (payment.softmatoTransactionNo) {
    const theirs = await trySoftmato(
      () => downloadReceiptFile(payment.softmatoTransactionNo as string),
      payment.softmatoTransactionNo,
    );

    if (theirs) return theirs;
  }

  const documentNumber =
    payment.localTransactionNo ?? (await ensureLocalReceiptNumber(payment._id));

  if (!documentNumber) return null;

  const invoice = await SubscriptionInvoiceModel.findById(
    payment.invoiceId,
  ).lean<{
    amount: number;
    billedTo?: { email?: string; hostelName?: string; name?: string };
    invoiceNumber: string;
    localInvoiceNo?: string | null;
    softmatoInvoiceNo?: string | null;
  } | null>();

  const bytes = await renderReceiptForRow(payment, {
    documentNumber,
    /*
     * The invoice as it is *printed*, not as we file it. A receipt whose
     * "Against Invoice" line quoted `SUB-0001-4F2A` would send an owner looking
     * for a number that appears nowhere on the invoice in their hand.
     */
    invoiceNumber:
      invoice?.softmatoInvoiceNo ??
      invoice?.localInvoiceNo ??
      invoice?.invoiceNumber ??
      "—",
    invoiceTotal: invoice?.amount ?? payment.amount,
    receivedFrom: {
      email: invoice?.billedTo?.email ?? "",
      name: invoice?.billedTo?.name || invoice?.billedTo?.hostelName || "",
    },
    totalReceived: invoice
      ? await settledTotal(payment.invoiceId)
      : payment.amount,
  });

  return {
    bytes,
    contentType: "application/pdf",
    filename: documentFileName(documentNumber),
    issuedBy: "platform",
  };
}
