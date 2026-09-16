import "server-only";

import { Types } from "mongoose";

import { bsFiscalYear } from "@hostel/shared/calendar/bs";
import { PlatformDocumentSequenceModel } from "@hostel/db/models/PlatformDocumentSequence";
import { SubscriptionInvoiceModel } from "@hostel/db/models/SubscriptionInvoice";
import { SubscriptionPaymentModel } from "@hostel/db/models/SubscriptionPayment";

import { connectToDatabase } from "@/lib/db";
import { getSiteConfigSection } from "@/modules/platform-config/site-config.service";
import { buildPresentation } from "@/modules/billing/softmato/presentation";

import type { Issuer } from "./document-parts";
import {
  renderInvoiceDocument,
  type InvoiceDocumentInput,
  type InvoicePresentation,
} from "./invoice-document";
import { renderReceiptDocument } from "./receipt-document";

/**
 * Issuing a document ourselves: allocate the number once, render from the rows
 * every time it is asked for.
 *
 * ## Two halves, and only the first one writes
 *
 * **Numbering** happens once, at the moment the obligation or the payment is
 * recorded, and is stored. **Rendering** happens on every download, every email
 * and every reissue, and stores nothing. That split is what makes the document
 * both immutable and un-cached: the number is the identity and can never move,
 * and the page is a pure function of rows that are themselves immutable —
 * `SubscriptionInvoice` snapshots the plan, the amount and `billedTo` at issue,
 * and `SubscriptionPayment` snapshots the method and the gateway's reference.
 *
 * A PDF written to R2 would be a second copy of something that cannot change,
 * with all of a second copy's failure modes and none of its benefits: a bucket
 * to keep in sync, a signed URL to expire, and a document that could silently
 * disagree with the row it came from after a migration.
 *
 * ## The prefix says who printed it
 *
 * `HH-INV-…` and `HH-TXN-…` for ours; `INV-…` and `TXN-…` are Softmato's own
 * and are never minted here. Both sequences run per fiscal year, both are
 * gapless-by-intent, and the prefix is the only thing that keeps them from
 * ever meeting. See `PlatformDocumentSequence` for why a burnt number is
 * preferred to a reused one.
 */

const PREFIX = {
  BOOKING_INVOICE: "HH-BKI",
  BOOKING_PAYOUT: "HH-BPO",
  BOOKING_RECEIPT: "HH-BKR",
  BOOKING_REFUND: "HH-BRF",
  SUBSCRIPTION_INVOICE: "HH-INV",
  SUBSCRIPTION_RECEIPT: "HH-TXN",
} as const;

/**
 * How wide each sequence is zero-padded.
 *
 * Different widths because the two documents are counted at different rates: an
 * invoice is raised once per hostel per billing cycle, a receipt once per
 * payment, and a part-paid plan produces several of the latter for one of the
 * former. Matching the parent company's own widths so that a hostel filing both
 * series together sees columns that line up.
 */
const WIDTH = {
  BOOKING_INVOICE: 6,
  BOOKING_PAYOUT: 8,
  BOOKING_RECEIPT: 8,
  BOOKING_REFUND: 8,
  SUBSCRIPTION_INVOICE: 6,
  SUBSCRIPTION_RECEIPT: 8,
} as const;

export type PlatformDocumentKind = keyof typeof PREFIX;
type DocumentKind = PlatformDocumentKind;

/**
 * The next number in a fiscal year's run.
 *
 * `$inc` with `upsert` is atomic, so two documents raised in the same
 * millisecond cannot be given the same number — and the first document of a new
 * fiscal year creates that year's row without anything having to notice the
 * year turned over.
 */
export async function allocate(kind: DocumentKind, issuedAt: Date): Promise<string> {
  const fiscalYear = bsFiscalYear(issuedAt);

  if (!fiscalYear) {
    throw new Error(
      `Cannot number a document dated ${issuedAt.toISOString()}: it is outside the Bikram Sambat conversion table, so there is no fiscal year to file it under.`,
    );
  }

  const counter = await PlatformDocumentSequenceModel.findOneAndUpdate(
    { fiscalYear, kind },
    { $inc: { sequence: 1 } },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  ).lean<{ sequence: number } | null>();

  const sequence = String(counter?.sequence ?? 1).padStart(WIDTH[kind], "0");

  return `${PREFIX[kind]}-${fiscalYear}-${sequence}`;
}

/* ── The issuer ────────────────────────────────────────────────────────── */

export async function loadIssuer(): Promise<Issuer> {
  const issuer = await getSiteConfigSection("issuer");

  return {
    address: issuer.address,
    email: issuer.email,
    legalName: issuer.legalName,
    pan: issuer.pan,
    phone: issuer.phone,
    productName: issuer.productName,
    vatRegistered: issuer.vatRegistered,
  };
}

/**
 * What the invoice offers as ways to pay.
 *
 * A sentence, not a form — the document names the rails and the owner uses
 * whichever one they were going to use anyway. It is fixed rather than read
 * from the gateway config because that config is a *hostel's* payment setup,
 * for collecting rent from residents, and printing it here would tell an owner
 * to pay us into their own eSewa account.
 */
const PAYMENT_METHODS = ["Khalti", "eSewa", "Bank transfer"];

/* ── Invoice ───────────────────────────────────────────────────────────── */

type InvoiceRow = {
  _id: Types.ObjectId;
  amount: number;
  billedTo?: { email?: string; hostelName?: string; name?: string };
  currency?: string;
  cycle: string;
  cycleMonths: number;
  invoiceNumber: string;
  issuedAt?: Date | null;
  localInvoiceNo?: string | null;
  localIssuedAt?: Date | null;
  planId: string;
  planName: string;
  softmatoInvoiceNo?: string | null;
  status: string;
};

/**
 * Gives an invoice our own number, if it does not already have one.
 *
 * Idempotent by read-then-write on a field that is only ever set once: a second
 * call returns the number already stored rather than burning another. The write
 * is conditional on the field still being null, so two racing callers cannot
 * both stamp the row — the loser's number is burnt, and the invoice keeps the
 * winner's. That is the trade `PlatformDocumentSequence` documents: a gap in
 * the run is survivable, two documents sharing a number is not.
 */
export async function ensureLocalInvoiceNumber(
  invoiceId: string | Types.ObjectId,
): Promise<string | null> {
  await connectToDatabase();

  const id =
    typeof invoiceId === "string" ? new Types.ObjectId(invoiceId) : invoiceId;

  const existing = await SubscriptionInvoiceModel.findById(id).lean<{
    issuedAt?: Date | null;
    localInvoiceNo?: string | null;
  } | null>();

  if (!existing) return null;
  if (existing.localInvoiceNo) return existing.localInvoiceNo;

  const issuedAt = existing.issuedAt ?? new Date();
  const localInvoiceNo = await allocate("SUBSCRIPTION_INVOICE", issuedAt);

  const updated = await SubscriptionInvoiceModel.findOneAndUpdate(
    { _id: id, localInvoiceNo: null },
    { $set: { localInvoiceNo, localIssuedAt: issuedAt } },
    { new: true },
  ).lean<{ localInvoiceNo?: string | null } | null>();

  // Null when another caller stamped it first, in which case the row already
  // has a number and this one's is burnt. Re-read rather than assume ours.
  return (
    updated?.localInvoiceNo ??
    (
      await SubscriptionInvoiceModel.findById(id).lean<{
        localInvoiceNo?: string | null;
      } | null>()
    )?.localInvoiceNo ??
    null
  );
}

/**
 * The invoice PDF, from the row and the catalogue.
 *
 * The plan block comes from `buildPresentation()` — the same bounded,
 * price-free copy that would have gone to Softmato to print on their document,
 * so the two issuers describe a plan identically. It is looked up in the live
 * catalogue by `planId`, which may have been deleted or renamed since; a miss
 * yields the plan *name snapshotted on the invoice* with no feature list, which
 * is the honest rendering of "we no longer sell this".
 */
export async function renderInvoiceForRow(
  invoice: InvoiceRow,
  options: { amountPaid: number; documentNumber: string },
): Promise<Uint8Array> {
  const [issuer, catalog] = await Promise.all([
    loadIssuer(),
    getSiteConfigSection("plans"),
  ]);

  const cycleLabel =
    catalog.cycleLabels[invoice.cycle as keyof typeof catalog.cycleLabels] ??
    invoice.cycle;
  const plan = catalog.plans.find((tier) => tier.id === invoice.planId) ?? null;
  const built = buildPresentation({
    cycleLabel,
    cycleMonths: invoice.cycleMonths,
    plan,
    planName: invoice.planName,
  });

  const presentation: InvoicePresentation | null = built
    ? {
        billingPeriod: built.billing_period,
        features: built.features,
        highlights: built.highlights,
        planName: built.plan_name,
        tagline: built.tagline,
      }
    : null;

  return renderInvoiceDocument({
    amountPaid: options.amountPaid,
    billedTo: {
      email: invoice.billedTo?.email ?? "",
      name: invoice.billedTo?.name || invoice.billedTo?.hostelName || "",
    },
    currency: invoice.currency ?? "NPR",
    documentNumber: options.documentNumber,
    issuedAt: invoice.localIssuedAt ?? invoice.issuedAt ?? new Date(),
    issuer,
    lines: [
      {
        amount: invoice.amount,
        description: `${invoice.planName} — ${cycleLabel}`,
        period: null,
        quantity: 1,
        rate: invoice.amount,
      },
    ],
    paymentMethods: PAYMENT_METHODS,
    presentation,
    status: invoiceStatus(invoice.status, options.amountPaid, invoice.amount),
  });
}

function invoiceStatus(
  status: string,
  paid: number,
  amount: number,
): InvoiceDocumentInput["status"] {
  if (status === "VOID") return "VOID";
  if (paid >= amount) return "PAID";

  return paid > 0 ? "PARTLY PAID" : "UNPAID";
}

/* ── Receipt ───────────────────────────────────────────────────────────── */

type PaymentRow = {
  _id: Types.ObjectId;
  amount: number;
  currency?: string;
  gatewayReference?: string | null;
  invoiceId: Types.ObjectId;
  localTransactionNo?: string | null;
  method: string;
  receiptNumber?: string | null;
  settledAt?: Date | null;
  softmatoProvider?: string | null;
  softmatoTransactionNo?: string | null;
  status: string;
};

/** See `ensureLocalInvoiceNumber` — same mechanism, same race, same trade. */
export async function ensureLocalReceiptNumber(
  paymentId: string | Types.ObjectId,
): Promise<string | null> {
  await connectToDatabase();

  const id =
    typeof paymentId === "string" ? new Types.ObjectId(paymentId) : paymentId;

  const existing = await SubscriptionPaymentModel.findById(id).lean<{
    localTransactionNo?: string | null;
    settledAt?: Date | null;
    status: string;
  } | null>();

  if (!existing) return null;
  if (existing.localTransactionNo) return existing.localTransactionNo;

  /*
   * No receipt before the money. Not a guard against a caller mistake — a
   * receipt is an assertion that a specific sum was received, and numbering one
   * for a payment still in flight puts a document into the world stating
   * something that may never become true.
   */
  if (existing.status !== "SETTLED") return null;

  const settledAt = existing.settledAt ?? new Date();
  const localTransactionNo = await allocate("SUBSCRIPTION_RECEIPT", settledAt);

  const updated = await SubscriptionPaymentModel.findOneAndUpdate(
    { _id: id, localTransactionNo: null },
    { $set: { localTransactionNo } },
    { new: true },
  ).lean<{ localTransactionNo?: string | null } | null>();

  return (
    updated?.localTransactionNo ??
    (
      await SubscriptionPaymentModel.findById(id).lean<{
        localTransactionNo?: string | null;
      } | null>()
    )?.localTransactionNo ??
    null
  );
}

/**
 * What the receipt calls the way the money arrived.
 *
 * `SOFTMATO` is the rail, not the method — an owner who paid with eSewa should
 * read "eSewa", because that is what they will look for on their own statement.
 * So the provider wins when the webhook told us one, and the rail's name is
 * never printed: nobody paid "by Softmato".
 */
function methodLabel(payment: PaymentRow): string {
  if (payment.method === "CASH") return "Cash";

  return payment.softmatoProvider || "Online payment";
}

export async function renderReceiptForRow(
  payment: PaymentRow,
  context: {
    documentNumber: string;
    invoiceNumber: string;
    invoiceTotal: number;
    receivedFrom: { email: string; name: string };
    totalReceived: number;
  },
): Promise<Uint8Array> {
  const issuer = await loadIssuer();

  return renderReceiptDocument({
    amount: payment.amount,
    currency: payment.currency ?? "NPR",
    documentNumber: context.documentNumber,
    invoiceNumber: context.invoiceNumber,
    invoiceTotal: context.invoiceTotal,
    issuer,
    method: methodLabel(payment),
    paidAt: payment.settledAt ?? new Date(),
    receivedFrom: context.receivedFrom,
    reference: payment.receiptNumber ?? context.documentNumber,
    totalReceived: context.totalReceived,
    transactionId:
      payment.softmatoTransactionNo || payment.gatewayReference || null,
  });
}

/**
 * A filename a reader can save without it colliding with the next one.
 *
 * The document number carries slashes — `HH-INV-2083/84-000012` — which are
 * path separators on every filesystem it might land on, so they are flattened
 * here rather than left to a browser or a mail client to mangle into something
 * unopenable.
 */
export function documentFileName(documentNumber: string): string {
  return `${documentNumber.replace(/\//g, "-")}.pdf`;
}
