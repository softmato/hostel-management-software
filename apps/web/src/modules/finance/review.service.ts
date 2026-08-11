import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { REALTIME_TOPIC } from "@/lib/realtime/channels";
import { publishResourceChange } from "@/lib/realtime/server";
import { auditFinanceAction } from "@/modules/finance/audit-finance";
import { FinanceServiceError } from "@/modules/finance/finance.errors";
import { extractReferenceCodes } from "@/modules/finance/reference-code";
import { notifyClaimReviewed } from "@/modules/finance/finance-notify";
import { settleEvent } from "@/modules/finance/payment-event.service";
import { markReferralConverted } from "@/modules/referrals/referral.service";
import { FileAssetModel } from "@hostel/db/models/FileAsset";
import { InvoiceBalanceModel } from "@hostel/db/models/InvoiceBalance";
import { InvoiceModel } from "@hostel/db/models/Invoice";
import { PaymentEventModel } from "@hostel/db/models/PaymentEvent";
import { ResidentModel } from "@hostel/db/models/Resident";

/**
 * The owner's review queue (target §11.4, plan item 2.8).
 *
 * Replaces `approvePaymentProof` / `rejectPaymentProof`. The behaviours those
 * earned the hard way are preserved and, where possible, are now structural
 * rather than remembered:
 *
 * - **Double approval is refused.** It used to be a `findOneAndUpdate` filtered
 *   on `status: "PENDING"` on the proof, followed by a five-attempt
 *   compare-and-set retry loop against the mutable `paidAmount`. `settleEvent`
 *   keeps the first half — the same PENDING-pinned filter — and deletes the
 *   second: there is no mutable balance to race, because the balance is a sum.
 * - **A part payment settles the month partially.** Unchanged in effect, but it
 *   now falls out of the arithmetic instead of a `Math.min` clamp.
 * - **The resident is told even when payment email is switched off** (item 0.6).
 */

export type ReviewQueueRow = {
  amount: number;
  confirmation: string;
  eventId: string;
  evidenceAssetId: string | null;
  /**
   * The evidence's MIME type, so the reviewer renders it with something that can
   * actually display it. A bank's PDF receipt in an `<img>` is a broken-image
   * icon, and a reviewer looking at one has no evidence at all — but the claim
   * still shows "Screenshot attached" in green.
   */
  evidenceMimeType: string | null;
  invoiceId: string | null;
  method: string;
  occurredAt: Date;
  period: string | null;
  referenceNote: string | null;
  residentId: string;
  residentName: string;
  /**
   * Every check, green or not (item 3.5). Computed on the server so the badge a
   * reviewer sees and the gate `Approve all` applies are the same rule — two
   * implementations of "looks fine" is how a bulk sweep approves a row the
   * screen had marked amber.
   */
  checks: ClaimCheck[];
  /** True when every check passed. The only rows `Approve all` may touch. */
  allGreen: boolean;
  /** Non-blocking notes, e.g. `SIMILAR_EVIDENCE` (item 3.4). Never a rejection. */
  reviewFlags: string[];
  status: string;
  transactionCode: string | null;
};

/**
 * One thing a reviewer would otherwise have to check by eye (target §11.4).
 *
 * `ok: false` is never a rejection and never blocks a single-row approval — the
 * owner may still approve a claim with an amber check, because they can see the
 * screenshot and we cannot. It only excludes the row from `Approve all`.
 */
export type ClaimCheck = {
  detail: string;
  key: "EVIDENCE" | "AMOUNT" | "INVOICE_OPEN" | "REFERENCE" | "SIMILARITY";
  ok: boolean;
};

type QueueEventRow = {
  _id: Types.ObjectId;
  amount: number;
  confirmation: string;
  evidenceAssetId?: Types.ObjectId | null;
  invoiceId?: Types.ObjectId | null;
  occurredAt: Date;
  provider?: string;
  rawPayload?: { referenceNote?: string | null; transactionCode?: string | null };
  residentId?: Types.ObjectId | null;
  reviewFlags?: string[];
  status: string;
};

/** Ledger provider → the word the review screen has always shown. */
const METHOD_BY_PROVIDER: Record<string, string> = {
  BANK: "BANK_TRANSFER",
  CASH: "CASH",
  ESEWA: "ESEWA",
  FONEPAY: "FONEPAY",
  KHALTI: "KHALTI",
  NONE: "OTHER",
};

/**
 * Claims awaiting a decision, newest first.
 *
 * Deliberately only `RESIDENT_CLAIM` events: gateway and statement money settles
 * itself and has never needed a human, and putting it here would bury the items
 * that do need one (target P7).
 */
export async function listReviewQueue(
  hostelId: Types.ObjectId | string,
  status: string = "PENDING",
): Promise<ReviewQueueRow[]> {
  await connectToDatabase();

  const events = await PaymentEventModel.find({
    hostelId,
    source: "RESIDENT_CLAIM",
    status,
  })
    .sort({ occurredAt: -1 })
    .limit(200)
    .lean<QueueEventRow[]>();

  if (events.length === 0) {
    return [];
  }

  const [residents, invoices, assets] = await Promise.all([
    // Soft-deleted residents are excluded here, and their claims are dropped
    // below. Costs no extra query — this lookup already existed for the names —
    // and keeps the queue agreeing with the count above it: the card counted
    // countable residents while the list showed everyone, so a deleted
    // resident's pending claim made the two disagree on the same screen.
    ResidentModel.find({
      _id: { $in: events.map((event) => event.residentId).filter(Boolean) },
      isDeleted: { $ne: true },
    })
      .select("firstName lastName")
      .lean<{ _id: Types.ObjectId; firstName?: string; lastName?: string }[]>(),
    InvoiceModel.find({
      _id: { $in: events.map((event) => event.invoiceId).filter(Boolean) },
    })
      .select("period referenceCode status totalAmount")
      .lean<InvoiceForCheck[]>(),
    FileAssetModel.find({
      _id: { $in: events.map((event) => event.evidenceAssetId).filter(Boolean) },
    })
      .select("mimeType")
      .lean<{ _id: Types.ObjectId; mimeType?: string }[]>(),
  ]);

  const mimeByAsset = new Map(
    assets.map((asset) => [asset._id.toString(), asset.mimeType ?? null]),
  );

  const balances = await InvoiceBalanceModel.find({
    invoiceId: { $in: invoices.map((invoice) => invoice._id) },
  })
    .select("invoiceId settledAmount")
    .lean<{ invoiceId: Types.ObjectId; settledAmount?: number }[]>();

  const invoiceById = new Map(
    invoices.map((invoice) => [invoice._id.toString(), invoice]),
  );
  const settledByInvoice = new Map(
    balances.map((balance) => [
      balance.invoiceId.toString(),
      balance.settledAmount ?? 0,
    ]),
  );

  const nameById = new Map(
    residents.map((resident) => [
      resident._id.toString(),
      `${resident.firstName ?? ""} ${resident.lastName ?? ""}`.trim(),
    ]),
  );
  const periodById = new Map(
    invoices.map((invoice) => [invoice._id.toString(), invoice.period ?? null]),
  );

  return events
    // A claim from a resident who no longer exists is not a decision anyone
    // should be offered: approving it would move money for somebody removed
    // from the product.
    .filter((event) => !event.residentId || nameById.has(event.residentId.toString()))
    .map((event) => {
    const invoice = event.invoiceId
      ? (invoiceById.get(event.invoiceId.toString()) ?? null)
      : null;
    const checks = claimChecks(event, invoice, {
      settled: event.invoiceId
        ? (settledByInvoice.get(event.invoiceId.toString()) ?? 0)
        : 0,
    });

    return {
    allGreen: checks.every((check) => check.ok),
    amount: event.amount,
    checks,
    confirmation: event.confirmation,
    eventId: event._id.toString(),
    evidenceAssetId: event.evidenceAssetId?.toString() ?? null,
    evidenceMimeType: event.evidenceAssetId
      ? (mimeByAsset.get(event.evidenceAssetId.toString()) ?? null)
      : null,
    invoiceId: event.invoiceId?.toString() ?? null,
    method: METHOD_BY_PROVIDER[event.provider ?? "NONE"] ?? "OTHER",
    occurredAt: event.occurredAt,
    period: event.invoiceId ? (periodById.get(event.invoiceId.toString()) ?? null) : null,
    referenceNote: event.rawPayload?.referenceNote ?? null,
    residentId: event.residentId?.toString() ?? "",
    residentName: event.residentId
      ? (nameById.get(event.residentId.toString()) ?? "")
      : "",
    reviewFlags: event.reviewFlags ?? [],
    status: event.status,
    transactionCode: event.rawPayload?.transactionCode ?? null,
    };
  });
}

type InvoiceForCheck = {
  _id: Types.ObjectId;
  period?: string;
  referenceCode?: string;
  status: string;
  totalAmount: number;
};

/**
 * Did the resident actually quote this invoice's reference code?
 *
 * **This check used to answer a different question than it appeared to.** It was
 * `ok: Boolean(invoice.referenceCode)` — whether the *invoice* carries a code,
 * which the billing run guarantees for every invoice it issues. So it was green
 * on essentially every row, and its label, `Reference EDU-0002-P`, read to an
 * owner as "the resident supplied EDU-0002-P" when nothing the resident typed
 * had been looked at. A check that is always green is not a check; it is
 * decoration that makes `Approve all` sweep rows nobody verified.
 *
 * It now reads what the resident actually submitted — the transaction id field
 * and the free-text note — through the same `extractReferenceCodes` the
 * statement matcher uses, so a code only counts if its check character verifies.
 *
 * The distinct amber for *a different invoice's code* is the valuable one: it is
 * a resident paying August's rent while quoting July's reference, which is the
 * single most common way money lands against the wrong month.
 */
function referenceCheck(
  event: {
    rawPayload?: { referenceNote?: string | null; transactionCode?: string | null };
  },
  invoice: InvoiceForCheck | null,
): ClaimCheck {
  const expected = invoice?.referenceCode;

  if (!expected) {
    return {
      detail: "Invoice has no reference code to quote",
      key: "REFERENCE",
      ok: false,
    };
  }

  const quoted = [
    ...extractReferenceCodes(event.rawPayload?.transactionCode),
    ...extractReferenceCodes(event.rawPayload?.referenceNote),
  ];

  if (quoted.includes(expected)) {
    return { detail: `Resident quoted ${expected}`, key: "REFERENCE", ok: true };
  }

  if (quoted.length > 0) {
    return {
      detail: `Quoted ${quoted[0]}, but this invoice is ${expected}`,
      key: "REFERENCE",
      ok: false,
    };
  }

  return {
    detail: `Did not quote ${expected}`,
    key: "REFERENCE",
    ok: false,
  };
}

/**
 * The checks, in the order a reviewer reads them (target §11.4).
 *
 * All five are things a careful owner does by eye today: is there a screenshot,
 * does the amount look right, is the invoice still open, did the resident quote
 * the reference code, and has anything like this image been seen before. Doing
 * them here rather than in the screen is what lets `Approve all` mean exactly
 * "the rows that were green".
 */
export function claimChecks(
  event: {
    amount: number;
    evidenceAssetId?: Types.ObjectId | null;
    rawPayload?: { referenceNote?: string | null; transactionCode?: string | null };
    reviewFlags?: string[];
  },
  invoice: InvoiceForCheck | null,
  balance: { settled: number },
): ClaimCheck[] {
  const outstanding = invoice
    ? Math.max(0, invoice.totalAmount - balance.settled)
    : 0;
  const reference = referenceCheck(event, invoice);

  return [
    {
      detail: event.evidenceAssetId ? "Screenshot attached" : "No screenshot attached",
      key: "EVIDENCE",
      ok: Boolean(event.evidenceAssetId),
    },
    {
      detail: invoice
        ? event.amount === outstanding
          ? "Matches the amount outstanding"
          : `Claimed ${event.amount} against ${outstanding} outstanding`
        : "Not attached to an invoice",
      key: "AMOUNT",
      // Exact only. A part payment is legitimate and an owner may still approve
      // it — but it is a decision, and a bulk sweep must not make decisions.
      ok: Boolean(invoice) && event.amount === outstanding,
    },
    {
      detail: invoice ? `Invoice is ${invoice.status}` : "Invoice missing",
      key: "INVOICE_OPEN",
      ok: invoice !== null && ["OPEN", "PARTIAL", "OVERDUE"].includes(invoice.status),
    },
    reference,
    {
      detail: event.reviewFlags?.includes("SIMILAR_EVIDENCE")
        ? "Looks like an earlier screenshot — compare them"
        : "No similar screenshot seen",
      key: "SIMILARITY",
      ok: !event.reviewFlags?.includes("SIMILAR_EVIDENCE"),
    },
  ];
}

/** Loads a claim, scoped to the hostels the caller may act in. */
async function findClaim(
  eventId: Types.ObjectId | string,
  hostelIds: string[],
): Promise<QueueEventRow & { hostelId: Types.ObjectId }> {
  const event = await PaymentEventModel.findOne({
    _id: Types.ObjectId.isValid(String(eventId)) ? eventId : new Types.ObjectId(),
    hostelId: { $in: hostelIds },
    source: "RESIDENT_CLAIM",
  }).lean<(QueueEventRow & { hostelId: Types.ObjectId }) | null>();

  if (!event) {
    // Out-of-scope and non-existent answer identically (RULES.md §3).
    throw new FinanceServiceError("Payment claim was not found.", "CLAIM_NOT_FOUND");
  }

  return event;
}

export async function approveClaim(
  eventId: string,
  principal: ApiPrincipal,
): Promise<{ eventId: string; receiptNumber: string | null; settledAmount: number }> {
  await connectToDatabase();

  const claim = await findClaim(eventId, principal.hostelIds);

  if (claim.status !== "PENDING") {
    throw new FinanceServiceError(
      "This claim has already been reviewed.",
      "CLAIM_ALREADY_REVIEWED",
    );
  }

  // `settleEvent` pins its filter to `status: "PENDING"`, so a double-click
  // loses the race there rather than crediting the invoice twice. It also
  // recomputes the balance and issues the receipt, in that order.
  const { balance, event, receipt } = await settleEvent(claim._id, {
    confirmation: "MANUAL_REVIEW",
    principal,
  });

  const invoice = claim.invoiceId
    ? await InvoiceModel.findOne({ _id: claim.invoiceId })
        .select("period totalAmount")
        .lean<{ period?: string; totalAmount: number } | null>()
    : null;

  // A referred resident only counts as converted once real money has been
  // verified (PHASES.md §5.1). Idempotent, and swallows its own failures.
  if (event.residentId) {
    await markReferralConverted({
      hostelId: claim.hostelId,
      paymentId: claim.invoiceId ?? claim._id,
      residentId: event.residentId,
    });

    await notifyClaimReviewed({
      hostelId: claim.hostelId,
      invoiceId: claim.invoiceId?.toString() ?? null,
      outcome: {
        kind: "verified",
        method: METHOD_BY_PROVIDER[claim.provider ?? "NONE"] ?? "OTHER",
        receiptId: receipt?._id ?? null,
        receiptNumber: receipt?.receiptNumber ?? null,
        remainingAmount: Math.max(
          (invoice?.totalAmount ?? 0) - (balance?.settledAmount ?? 0),
          0,
        ),
        verifiedAmount: event.amount,
      },
      period: invoice?.period ?? null,
      residentId: event.residentId,
    });
  }

  await publishResourceChange({
    hostelIds: [claim.hostelId.toString()],
    topics: [REALTIME_TOPIC.PAYMENTS],
  });

  return {
    eventId: claim._id.toString(),
    receiptNumber: receipt?.receiptNumber ?? null,
    settledAmount: balance?.settledAmount ?? event.amount,
  };
}

export async function rejectClaim(
  eventId: string,
  rejectionReason: string,
  principal: ApiPrincipal,
): Promise<{ eventId: string; status: string }> {
  await connectToDatabase();

  const claim = await findClaim(eventId, principal.hostelIds);

  // Pinned to PENDING for the same reason approval is: whoever gets there first
  // decides, and the loser is told rather than silently overwriting a decision.
  const rejected = await PaymentEventModel.findOneAndUpdate(
    { _id: claim._id, status: "PENDING" },
    {
      $set: {
        rejectionReason,
        reviewedAt: new Date(),
        reviewedBy: principal.userId,
        status: "REJECTED",
      },
    },
    { new: true },
  ).lean<{ _id: Types.ObjectId } | null>();

  if (!rejected) {
    throw new FinanceServiceError(
      "This claim has already been reviewed.",
      "CLAIM_ALREADY_REVIEWED",
    );
  }

  await auditFinanceAction(principal, {
    action: "PAYMENT_CLAIM_REJECTED",
    // A rejection moves no money — that is exactly what it decides.
    amountAfter: 0,
    amountBefore: 0,
    entityId: claim._id,
    entityType: "PaymentEvent",
    eventId: claim._id.toString(),
    hostelId: claim.hostelId,
    invoiceId: claim.invoiceId?.toString(),
    reason: rejectionReason,
    source: "CLAIM_REVIEW",
  });

  if (claim.residentId) {
    const invoice = claim.invoiceId
      ? await InvoiceModel.findOne({ _id: claim.invoiceId })
          .select("period")
          .lean<{ period?: string } | null>()
      : null;

    await notifyClaimReviewed({
      hostelId: claim.hostelId,
      invoiceId: claim.invoiceId?.toString() ?? null,
      outcome: { kind: "rejected", rejectionReason },
      period: invoice?.period ?? null,
      residentId: claim.residentId,
    });
  }

  await publishResourceChange({
    hostelIds: [claim.hostelId.toString()],
    topics: [REALTIME_TOPIC.PAYMENTS],
  });

  return { eventId: claim._id.toString(), status: "REJECTED" };
}

export type BulkApproveResult = {
  approved: string[];
  /** Rows the sweep declined, with the check that stopped each one. */
  skipped: { eventId: string; reason: string }[];
};

/**
 * `Approve all` (target §11.4, plan item 3.5).
 *
 * **Sweeps only all-green rows, and re-derives green here.** The screen sends
 * the ids it believes are clean, but a row can go amber between render and
 * click — another approval lands, the invoice closes — and trusting the client's
 * judgement would let a bulk action approve something a reviewer was never shown
 * as safe. Every skipped row is returned with the check that stopped it, so the
 * owner sees what was left behind rather than a silently smaller count.
 *
 * Approvals run one at a time through `approveClaim`, so each keeps its own
 * receipt, audit entry and resident notification. A failure part-way leaves the
 * successful ones settled — which is correct: they are real money, and ADR-4
 * says detect rather than prevent.
 */
export async function bulkApproveClaims(
  hostelId: Types.ObjectId | string,
  eventIds: string[],
  principal: ApiPrincipal,
): Promise<BulkApproveResult> {
  await connectToDatabase();

  const queue = await listReviewQueue(hostelId, "PENDING");
  const greenById = new Map(queue.map((row) => [row.eventId, row]));

  const result: BulkApproveResult = { approved: [], skipped: [] };

  for (const eventId of eventIds) {
    const row = greenById.get(eventId);

    if (!row) {
      result.skipped.push({ eventId, reason: "No longer awaiting review." });
      continue;
    }

    const failed = row.checks.find((check) => !check.ok);

    if (failed) {
      result.skipped.push({ eventId, reason: failed.detail });
      continue;
    }

    try {
      await approveClaim(eventId, principal);
      result.approved.push(eventId);
    } catch (error) {
      result.skipped.push({
        eventId,
        reason: error instanceof Error ? error.message : "Could not approve.",
      });
    }
  }

  return result;
}
