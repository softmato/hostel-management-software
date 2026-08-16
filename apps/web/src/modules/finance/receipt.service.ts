import type { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { auditFinanceAction } from "@/modules/finance/audit-finance";
import { FinanceServiceError } from "@/modules/finance/finance.errors";
import { listResidentInvoices } from "@/modules/finance/ledger-read.service";
import { renderReceiptPdf, renderStatementPdf } from "@/modules/finance/receipt-pdf";
import { HostelModel } from "@hostel/db/models/Hostel";
import { InvoiceModel } from "@hostel/db/models/Invoice";
import { PaymentEventModel } from "@hostel/db/models/PaymentEvent";
import { ResidentModel } from "@hostel/db/models/Resident";
import { ReceiptCounterModel } from "@hostel/db/models/ReceiptCounter";
import { ReceiptModel } from "@hostel/db/models/Receipt";

/**
 * Receipts (target §4.4, plan item 2.6).
 *
 * Two things change from the current implementation, and both are correctness
 * rather than polish.
 *
 * **Numbering is atomic.** The old allocator was
 * `findOne({receiptNumber: /^prefix/}).sort({receiptNumber: -1})` — a race
 * dressed as a query. It works only because the sequence is zero-padded to five
 * digits, so it breaks at 100,000 receipts in a month, and two concurrent
 * approvals read the same "last" number and then fight over the unique index
 * with a five-attempt retry loop (current §5.5). One `findOneAndUpdate($inc)` is
 * atomic in MongoDB: distinct numbers, no retry, no loop, no ceiling.
 *
 * **Numbering is per hostel.** A global sequence interleaves one hostel's
 * receipts with another's, and the gaps leak the platform's monthly volume to
 * anyone who looks at their own numbers. The hostel's reference prefix goes into
 * the number so two hostels' sequences cannot collide on the unique index.
 */

export type ReceiptRecord = {
  _id: Types.ObjectId;
  amount: number;
  eventId?: Types.ObjectId | null;
  hostelId: Types.ObjectId;
  invoiceId?: Types.ObjectId | null;
  issuedAt: Date;
  receiptNumber: string;
  residentId: Types.ObjectId;
  voidedAt?: Date | null;
};

/**
 * The next receipt number for a hostel and period, e.g. `RCP-EDU-2026-08-00001`.
 *
 * Padded to five digits for readability only — the sequence is a number and
 * keeps counting past 99,999, which is where the string-sorted version silently
 * started reusing numbers.
 */
export async function nextReceiptNumber(
  hostelId: Types.ObjectId | string,
  period: string,
  hostelPrefix?: string | null,
): Promise<string> {
  const counter = await ReceiptCounterModel.findOneAndUpdate(
    { hostelId, kind: "RECEIPT", period },
    { $inc: { sequence: 1 } },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  ).lean<{ sequence: number } | null>();

  const sequence = counter?.sequence ?? 1;
  const segments = ["RCP", hostelPrefix, period, String(sequence).padStart(5, "0")];

  return segments.filter(Boolean).join("-");
}

/** "YYYY-MM" from a date, in UTC, so a receipt's period does not depend on where it was issued. */
export function periodOfDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The dates a monthly invoice's period covers — first day to last day, UTC.
 *
 * Derived rather than stored because `Invoice` holds `period` and nothing else:
 * there is no `periodStart`/`periodEnd` on the model, and adding a pair of
 * denormalised dates that must agree with the string forever is a worse trade
 * than computing them where they are printed. Day 0 of the following month is the
 * last day of this one, which is also how February and leap years come out right
 * without a table.
 *
 * Returns null for anything that is not a `YYYY-MM` month. A one-off invoice — an
 * admission fee, a deposit — covers no span, and a receipt for one is honest by
 * omitting the line rather than by inventing a month it did not buy.
 */
export function periodCoverage(
  period: string | null | undefined,
): { from: Date; to: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period ?? "");

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (month < 1 || month > 12) {
    return null;
  }

  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 0)),
  };
}

export type IssueReceiptInput = {
  amount: number;
  eventId: Types.ObjectId | string;
  hostelId: Types.ObjectId | string;
  invoiceId?: Types.ObjectId | string | null;
  issuedAt?: Date;
  residentId: Types.ObjectId | string;
};

/**
 * Issues the receipt for a settled event.
 *
 * **Idempotent on `eventId`.** The unique partial index is what guarantees one
 * receipt per event; this catches the duplicate-key error and returns the
 * receipt that already exists, so a retried settlement — or the crash-and-resume
 * path that ADR-4 deliberately leaves possible — cannot produce two documents
 * claiming the same money.
 *
 * Called after the balance is recomputed and before the resident is notified,
 * which is the ordering `payment-event.service` documents and must keep.
 */
export async function issueReceiptForEvent(
  input: IssueReceiptInput,
  principal?: ApiPrincipal,
): Promise<ReceiptRecord> {
  await connectToDatabase();

  const issuedAt = input.issuedAt ?? new Date();

  const existing = await ReceiptModel.findOne({
    eventId: input.eventId,
  }).lean<ReceiptRecord | null>();

  if (existing) {
    return existing;
  }

  const hostel = await HostelModel.findOne({ _id: input.hostelId })
    .select("referencePrefix")
    .lean<{ referencePrefix?: string } | null>();

  try {
    return (await ReceiptModel.create({
      amount: input.amount,
      eventId: input.eventId,
      hostelId: input.hostelId,
      invoiceId: input.invoiceId ?? null,
      issuedAt,
      issuedBy: principal?.userId ?? null,
      receiptNumber: await nextReceiptNumber(
        input.hostelId,
        periodOfDate(issuedAt),
        hostel?.referencePrefix,
      ),
      residentId: input.residentId,
    })) as unknown as ReceiptRecord;
  } catch (error) {
    if ((error as { code?: number })?.code !== 11000) {
      throw error;
    }

    // Two settlements of the same event raced. The index refused the second;
    // return the one that won rather than surfacing a conflict the caller
    // cannot act on.
    const winner = await ReceiptModel.findOne({
      eventId: input.eventId,
    }).lean<ReceiptRecord | null>();

    if (!winner) {
      throw error;
    }

    return winner;
  }
}

/**
 * A receipt rendered as PDF bytes, for whoever is allowed to see it.
 *
 * `scope` is the authorization, and it is a parameter rather than a lookup so
 * the two callers cannot accidentally share one: a resident may read only their
 * own receipt, a staff member only their hostel's. A receipt that does not match
 * is reported as missing rather than forbidden — out-of-scope and non-existent
 * must be indistinguishable from outside the tenant (RULES.md §3).
 */
export async function renderReceiptById(
  receiptId: Types.ObjectId | string,
  scope: { hostelIds?: string[]; residentId?: Types.ObjectId | string },
): Promise<{ bytes: Uint8Array; receiptNumber: string }> {
  await connectToDatabase();

  const filter: Record<string, unknown> = { _id: receiptId };

  if (scope.residentId) {
    filter.residentId = scope.residentId;
  }

  if (scope.hostelIds) {
    filter.hostelId = { $in: scope.hostelIds };
  }

  const receipt = await ReceiptModel.findOne(filter).lean<
    | (ReceiptRecord & {
        voidReason?: string | null;
      })
    | null
  >();

  if (!receipt) {
    throw new FinanceServiceError("Receipt was not found.", "RECEIPT_NOT_FOUND");
  }

  const [hostel, resident, invoice, event] = await Promise.all([
    HostelModel.findOne({ _id: receipt.hostelId })
      .select("name")
      .lean<{ name?: string } | null>(),
    ResidentModel.findOne({ _id: receipt.residentId })
      .select("firstName fullName lastName")
      .lean<{ firstName?: string; fullName?: string; lastName?: string } | null>(),
    receipt.invoiceId
      ? InvoiceModel.findOne({ _id: receipt.invoiceId })
          .select("period referenceCode")
          .lean<{ period?: string; referenceCode?: string } | null>()
      : null,
    // Read at render time rather than snapshotted onto the receipt (item E.7).
    // The confirmation level changes *after* the document is minted — that is the
    // entire point of provisional credit — and a copy on the receipt would still
    // be hedging weeks after the statement confirmed the money.
    receipt.eventId
      ? PaymentEventModel.findOne({ _id: receipt.eventId })
          .select("confirmation")
          .lean<{ confirmation?: string } | null>()
      : null,
  ]);

  const coverage = periodCoverage(invoice?.period);

  const bytes = await renderReceiptPdf({
    amount: receipt.amount,
    coversFrom: coverage?.from ?? null,
    coversTo: coverage?.to ?? null,
    hostelName: hostel?.name ?? "Hostel",
    invoicePeriod: invoice?.period ?? null,
    issuedAt: receipt.issuedAt,
    // Only `MANUAL_REVIEW` hedges. A statement match and a gateway verification
    // are both independent of the payer; an `UNCONFIRMED` event has no business
    // holding a receipt at all, and a receipt with no event behind it predates
    // the ledger — neither is a case for putting a warning on a resident's
    // document about a distinction the product did not make when it was issued.
    provisional: event?.confirmation === "MANUAL_REVIEW",
    receiptNumber: receipt.receiptNumber,
    referenceCode: invoice?.referenceCode ?? null,
    residentName:
      resident?.fullName ??
      [resident?.firstName, resident?.lastName].filter(Boolean).join(" ") ??
      "Resident",
    voidReason: receipt.voidReason ?? null,
    voidedAt: receipt.voidedAt ?? null,
  });

  return { bytes, receiptNumber: receipt.receiptNumber };
}

/**
 * The resident's own statement, as PDF bytes.
 *
 * Reads through the ledger facade rather than either model directly, so the
 * statement says the same thing before and after the cutover — the one document
 * a resident may hand to a landlord or a visa officer is the last place a
 * source-dependent answer would be acceptable.
 */
export async function renderStatementForResident(scope: {
  hostelId: Types.ObjectId | string;
  residentId: Types.ObjectId | string;
  residentName: string;
}): Promise<Uint8Array> {
  await connectToDatabase();

  const [hostel, invoices] = await Promise.all([
    HostelModel.findOne({ _id: scope.hostelId })
      .select("name")
      .lean<{ name?: string } | null>(),
    listResidentInvoices({ hostelId: scope.hostelId, residentId: scope.residentId }),
  ]);

  return renderStatementPdf({
    generatedAt: new Date(),
    hostelName: hostel?.name ?? "Hostel",
    residentName: scope.residentName,
    rows: invoices.map((invoice) => ({
      dueAmount: invoice.dueAmount,
      paidAmount: invoice.paidAmount,
      period: invoice.period,
      status: invoice.status,
    })),
  });
}

/**
 * Voids a receipt and issues its replacement (target §4.4).
 *
 * The correction path, because a receipt is immutable: the original keeps its
 * number and its amount and gains only the fact that it was voided, so a
 * resident holding the old document can be told exactly what happened to it. The
 * replacement gets a fresh number — reusing the voided one would make two
 * different documents answer to the same identifier.
 *
 * A reversal calls this with no replacement: there is no new receipt when the
 * money went back.
 */
export async function voidReceipt(
  receiptId: Types.ObjectId | string,
  options: {
    principal: ApiPrincipal;
    reason: string;
    reissue?: { amount: number };
  },
): Promise<{ receipt: ReceiptRecord; replacement: ReceiptRecord | null }> {
  await connectToDatabase();

  if (!options.reason || options.reason.trim().length < 3) {
    throw new FinanceServiceError(
      "Voiding a receipt needs a reason.",
      "AMOUNT_OUT_OF_BOUNDS",
    );
  }

  const receipt = await ReceiptModel.findOne({
    _id: receiptId,
  }).lean<ReceiptRecord | null>();

  if (!receipt) {
    throw new FinanceServiceError("Receipt was not found.", "FEE_SCHEDULE_MISSING");
  }

  if (receipt.voidedAt) {
    throw new FinanceServiceError(
      "This receipt has already been voided.",
      "RECEIPT_ALREADY_VOID",
    );
  }

  let replacement: ReceiptRecord | null = null;

  if (options.reissue) {
    const hostel = await HostelModel.findOne({ _id: receipt.hostelId })
      .select("referencePrefix")
      .lean<{ referencePrefix?: string } | null>();
    const issuedAt = new Date();

    replacement = (await ReceiptModel.create({
      amount: options.reissue.amount,
      // Deliberately not `eventId`: the unique index permits one receipt per
      // event, and the voided one already holds it. A replacement is a document
      // about the same money, not a second claim to it.
      hostelId: receipt.hostelId,
      invoiceId: receipt.invoiceId ?? null,
      issuedAt,
      issuedBy: options.principal.userId,
      receiptNumber: await nextReceiptNumber(
        receipt.hostelId,
        periodOfDate(issuedAt),
        hostel?.referencePrefix,
      ),
      residentId: receipt.residentId,
    })) as unknown as ReceiptRecord;
  }

  await ReceiptModel.updateOne(
    { _id: receipt._id },
    {
      $set: {
        replacedByReceiptId: replacement?._id ?? null,
        voidReason: options.reason,
        voidedAt: new Date(),
        voidedBy: options.principal.userId,
      },
    },
  );

  await auditFinanceAction(options.principal, {
    action: "RECEIPT_VOIDED",
    amountAfter: replacement?.amount ?? 0,
    amountBefore: receipt.amount,
    entityId: receipt._id,
    entityType: "Receipt",
    hostelId: receipt.hostelId,
    invoiceId: receipt.invoiceId?.toString(),
    reason: options.reason,
    source: "RECEIPT_VOID",
  });

  return { receipt, replacement };
}
