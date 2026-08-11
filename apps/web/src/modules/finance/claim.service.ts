import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { REALTIME_TOPIC } from "@/lib/realtime/channels";
import { publishResourceChange } from "@/lib/realtime/server";
import { auditFinanceAction } from "@/modules/finance/audit-finance";
import { isPerceptualNearDuplicate } from "@/modules/finance/evidence";
import { FinanceServiceError } from "@/modules/finance/finance.errors";
import { notifyAdminsOfClaim } from "@/modules/finance/finance-notify";
import { appendEvent } from "@/modules/finance/payment-event.service";
import { findCurrentResident } from "@/modules/residents/resident-access";
import type { ResidentRecord } from "@/modules/residents/resident-access";
import { FileAssetModel } from "@hostel/db/models/FileAsset";
import { InvoiceBalanceModel } from "@hostel/db/models/InvoiceBalance";
import { InvoiceModel } from "@hostel/db/models/Invoice";
import { PaymentEventModel } from "@hostel/db/models/PaymentEvent";
import type { ClaimSubmitInput } from "@/modules/finance/claim.validation";

/**
 * A resident telling the hostel they have paid (target §11.2, plan item 2.8).
 *
 * The `PaymentProof` version of this, and every hard-won guard on it, moves here
 * intact — item 0.2's asset-ownership check and item 0.3's upload verification
 * were security fixes, and a rewrite that quietly dropped them would reopen both.
 * What changes is the record it produces: a `PENDING` `PaymentEvent` rather than
 * a `PaymentProof` row plus a mutated `Payment.status`.
 *
 * A claim is **unconfirmed money**, which is the point of modelling it as an
 * event: it sits in the ledger with `status: PENDING` and contributes nothing to
 * any balance until a human settles it. Nothing has to remember to exclude it.
 */

type UsableAsset = {
  _id: Types.ObjectId;
  contentHash?: string;
  mimeType?: string;
  perceptualHash?: string;
  sizeBytes?: number;
  /** Set when the file is one this system generated — a receipt or statement. */
  systemDocumentKind?: "RECEIPT" | "STATEMENT";
};

/**
 * Evidence a resident is allowed to submit (target §13.2/§13.3, items 0.2/0.3).
 *
 * `proofImageAssetId` was a free string that nothing checked, so a resident could
 * submit someone else's asset id as their own evidence — and, before item 0.1
 * closed the read side, could enumerate one to submit. Five properties, all
 * required:
 *
 * 1. the asset exists and is live;
 * 2. its owner is the submitting user;
 * 3. it belongs to this hostel — an asset labelled for another tenant is not
 *    evidence here even if the same person owns it;
 * 4. its upload was verified, so the bytes exist and match what was declared;
 * 5. no other event already references it, so one screenshot settles one claim.
 */
export async function assertClaimAssetUsable(
  assetId: string,
  resident: { hostelId: Types.ObjectId },
  principal: ApiPrincipal,
): Promise<UsableAsset> {
  const asset = Types.ObjectId.isValid(assetId)
    ? await FileAssetModel.findOne({
        _id: assetId,
        isDeleted: false,
        status: "ACTIVE",
      }).lean<
        | (UsableAsset & {
            hostelId?: Types.ObjectId;
            ownerId?: Types.ObjectId;
            uploadCompletedAt?: Date;
          })
        | null
      >()
    : null;

  // A missing asset and someone else's asset answer identically: a resident
  // probing ids must not learn which ones exist.
  if (!asset || asset.ownerId?.toString() !== principal.userId) {
    throw new FinanceServiceError(
      "This file is not yours to submit. Upload the screenshot again.",
      "ASSET_NOT_OWNED",
    );
  }

  if (asset.hostelId && asset.hostelId.toString() !== resident.hostelId.toString()) {
    throw new FinanceServiceError(
      "This file is not yours to submit. Upload the screenshot again.",
      "ASSET_NOT_OWNED",
    );
  }

  // An asset whose bytes were never confirmed is a reservation, not a file: the
  // type and size on it are the client's own claim.
  if (!asset.uploadCompletedAt) {
    throw new FinanceServiceError(
      "This file did not finish uploading. Please upload the screenshot again.",
      "ASSET_UPLOAD_INCOMPLETE",
    );
  }

  // Our own receipt is not evidence that the resident paid — it is our record
  // that the hostel was paid, which is the opposite direction. It was accepted
  // before this check, and every claim check went green: a resident could
  // download September's receipt and submit it as proof for August.
  //
  // Non-accusatory, like the duplicate-evidence copy (target §8.2). Downloading
  // the wrong file is the overwhelmingly likely explanation — the receipt is the
  // most recent payment document most residents have.
  if (asset.systemDocumentKind) {
    throw new FinanceServiceError(
      asset.systemDocumentKind === "STATEMENT"
        ? "That is your hostel statement, which we generated. Please upload the screenshot or receipt from the app you paid with."
        : "That is a receipt your hostel issued, not a record of your payment. Please upload the screenshot or receipt from the app you paid with.",
      "EVIDENCE_IS_SYSTEM_DOCUMENT",
    );
  }

  const alreadyUsed = await PaymentEventModel.exists({
    evidenceAssetId: asset._id,
    hostelId: resident.hostelId,
  });

  if (alreadyUsed) {
    throw new FinanceServiceError(
      "This screenshot has already been submitted. Please upload the screenshot for this payment.",
      "EVIDENCE_ALREADY_USED",
    );
  }

  return asset;
}

/**
 * A claim may not exceed what is owed by more than half (target §6.2 step 5d).
 *
 * The headroom is for the genuine cases — a resident clearing a small arrear
 * along with the month, or rounding a transfer up — while still stopping the
 * typo that turns 1,200 into 12,000. It is checked against what is *outstanding*
 * rather than the invoice total, so a second claim on a part-paid month is
 * measured against the part that is left.
 */
async function assertAmountWithinBounds(
  amount: number,
  invoice: { _id: Types.ObjectId; totalAmount: number },
) {
  if (amount <= 0) {
    throw new FinanceServiceError(
      "Enter the amount you actually paid.",
      "AMOUNT_OUT_OF_BOUNDS",
    );
  }

  const balance = await InvoiceBalanceModel.findOne({
    invoiceId: invoice._id,
  }).lean<{ settledAmount?: number } | null>();

  const outstanding = Math.max(0, invoice.totalAmount - (balance?.settledAmount ?? 0));

  if (outstanding > 0 && amount > Math.round(outstanding * 1.5)) {
    throw new FinanceServiceError(
      `That is much more than the ${outstanding} still owed on this invoice. Check the amount and try again.`,
      "AMOUNT_OUT_OF_BOUNDS",
    );
  }
}

/**
 * The same screenshot, re-uploaded as a new asset (target §8.1/§8.2).
 *
 * `assertClaimAssetUsable` catches the same *asset* used twice; this catches the
 * same *bytes* arriving under a fresh id, which is what actually happens — the
 * resident picks the file from their gallery again. Scoped to the hostel, always:
 * comparing hashes across hostels would leak that another hostel holds the same
 * image, which is a privacy leak dressed as a fraud control.
 *
 * **This never reaches the owner's queue** (target P7, invariant 9). Rejecting
 * at submission is the whole point — a duplicate that lands in front of a human
 * has already cost the thing the check exists to save. The copy says what to do
 * and does not accuse: an honest resident who tapped submit twice sees it far
 * more often than anyone else.
 */
async function assertEvidenceNotAlreadyClaimed(
  asset: UsableAsset,
  hostelId: Types.ObjectId,
) {
  if (!asset.contentHash) return;

  const duplicate = await PaymentEventModel.findOne({
    evidenceHash: asset.contentHash,
    hostelId,
  }).lean<PriorClaim | null>();

  if (duplicate) {
    throw new FinanceServiceError(
      "This screenshot has already been submitted for a payment. If this is a different payment, upload the screenshot for that one.",
      "EVIDENCE_ALREADY_USED",
      await describePriorClaim(duplicate),
    );
  }
}

type PriorClaim = {
  invoiceId?: Types.ObjectId | null;
  occurredAt?: Date;
};

/**
 * When and what the duplicate collided with, for the rejection card (§11.3).
 *
 * "This screenshot was already used" leaves the resident with nowhere to go.
 * "It was submitted on 2 Jul 2026 for July rent" tells them it was last month's,
 * which is the whole difference between a dead end and a resident who goes and
 * finds the right screenshot.
 *
 * Both fields are the caller's own earlier claim, so nothing here crosses a
 * resident boundary. Best-effort on purpose — a missing period must degrade the
 * sentence, never turn a clear rejection into a 500.
 */
async function describePriorClaim(prior: PriorClaim) {
  const invoice = prior.invoiceId
    ? await InvoiceModel.findById(prior.invoiceId).lean<{ period?: string } | null>()
    : null;

  return {
    priorPeriod: invoice?.period ?? null,
    priorSubmittedAt: prior.occurredAt ? new Date(prior.occurredAt).toISOString() : null,
  };
}

/**
 * The same transaction id, typed onto a second claim (target §11.3).
 *
 * One transfer has one id, so a second claim carrying it is either a resident
 * submitting last month's payment again or a typo — and both belong here, not in
 * the owner's queue. The lookup is explicit rather than a unique index because
 * the index can only refuse: it cannot say *which* payment the id already
 * belongs to, and without that the resident has nothing to act on.
 *
 * Scoped to the hostel and the provider. Across providers an eight-digit id
 * genuinely can repeat, and refusing a real bank transfer because a wallet
 * receipt happened to share its number is a worse failure than letting a human
 * see both. `rawPayload.transactionCode` is unindexed, so the `hostelId`
 * equality carries the query — one hostel's event history, not the platform's.
 */
async function assertTransactionCodeNotReused(
  transactionCode: string | null | undefined,
  hostelId: Types.ObjectId,
  provider: string,
) {
  const code = transactionCode?.trim();

  if (!code) return;

  const duplicate = await PaymentEventModel.findOne({
    hostelId,
    provider,
    "rawPayload.transactionCode": code,
    status: { $ne: "REJECTED" },
  }).lean<PriorClaim | null>();

  if (!duplicate) return;

  throw new FinanceServiceError(
    `Transaction ID ${code} has already been recorded for a payment. Each payment has its own ID — check the ID on this transfer.`,
    "TXN_ID_ALREADY_CLAIMED",
    { ...(await describePriorClaim(duplicate)), transactionCode: code },
  );
}

/**
 * Screenshots that merely *look* alike (plan item 3.4).
 *
 * Returns flags, never an error. A perceptual match is evidence and not proof —
 * a resident who re-crops or re-compresses the same transfer produces one
 * innocently, and so do two consecutive transfers of the same amount from the
 * same app. Auto-rejecting on it would refuse real payments, so the only
 * correct action is to put a note in front of a human who can see both images.
 */
async function similarEvidenceFlags(
  asset: UsableAsset,
  hostelId: Types.ObjectId,
): Promise<string[]> {
  if (!asset.perceptualHash) return [];

  const recent = await FileAssetModel.find({
    _id: { $ne: asset._id },
    hostelId,
    perceptualHash: { $exists: true, $ne: null },
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .select("perceptualHash")
    .lean<{ perceptualHash?: string }[]>();

  const similar = recent.some(
    (other) =>
      other.perceptualHash &&
      isPerceptualNearDuplicate(asset.perceptualHash!, other.perceptualHash),
  );

  return similar ? ["SIMILAR_EVIDENCE"] : [];
}

export type SubmitClaimResult = {
  /** False when the same claim was already recorded — a replay, not a second claim. */
  created: boolean;
  eventId: string;
  status: string;
};

export async function submitClaim(
  invoiceId: string,
  input: ClaimSubmitInput,
  principal: ApiPrincipal,
): Promise<SubmitClaimResult> {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);

  const invoice = await InvoiceModel.findOne({
    _id: Types.ObjectId.isValid(invoiceId) ? invoiceId : new Types.ObjectId(),
    hostelId: resident.hostelId,
    residentId: resident._id,
  }).lean<{
    _id: Types.ObjectId;
    hostelId: Types.ObjectId;
    period?: string;
    referenceCode?: string;
    status: string;
    totalAmount: number;
  } | null>();

  if (!invoice) {
    throw new FinanceServiceError("Invoice was not found.", "INVOICE_NOT_FOUND");
  }

  if (invoice.status === "PAID") {
    throw new FinanceServiceError(
      "This invoice is already paid.",
      "INVOICE_ALREADY_PAID",
    );
  }

  if (invoice.status === "VOID") {
    throw new FinanceServiceError(
      "This invoice was cancelled.",
      "INVOICE_NOT_FOUND",
    );
  }

  const asset = await assertClaimAssetUsable(input.proofImageAssetId, resident, principal);
  const provider =
    input.paymentMethod === "BANK_TRANSFER" ? "BANK" : input.paymentMethod;

  await assertAmountWithinBounds(input.amount, invoice);
  await assertEvidenceNotAlreadyClaimed(asset, invoice.hostelId);
  await assertTransactionCodeNotReused(
    input.transactionCode,
    invoice.hostelId,
    provider,
  );

  const reviewFlags = await similarEvidenceFlags(asset, invoice.hostelId);

  // `claim:{residentId}:{invoiceId}:{contentHash}` (§5.2). The hash is read back
  // from storage by item 0.3, never client-sent, so a double-tapped submit
  // collapses to one event by construction rather than by a check.
  const { created, event } = await appendEvent({
    amount: input.amount,
    confirmation: "UNCONFIRMED",
    evidenceAssetId: asset._id,
    evidenceHash: asset.contentHash ?? null,
    hostelId: invoice.hostelId,
    idempotencyKey: `claim:${resident._id.toString()}:${invoice._id.toString()}:${
      asset.contentHash ?? asset._id.toString()
    }`,
    invoiceId: invoice._id,
    occurredAt: input.paidAt ?? new Date(),
    provider,
    rawPayload: {
      referenceNote: input.referenceNote ?? null,
      submittedBy: principal.userId,
      // Resident-typed and unverified, so it stays out of the indexed
      // `providerTxnId`: one resident's typo must not block another's claim on a
      // uniqueness collision.
      transactionCode: input.transactionCode ?? null,
    },
    referenceCode: invoice.referenceCode ?? null,
    residentId: resident._id,
    reviewFlags,
    source: "RESIDENT_CLAIM",
    status: "PENDING",
  });

  if (created) {
    await auditFinanceAction(principal, {
      action: "PAYMENT_CLAIM_SUBMITTED",
      // No money has moved: a claim is a statement, not a settlement. Both
      // amounts are the balance, which this does not change.
      amountAfter: 0,
      amountBefore: 0,
      entityId: event._id,
      entityType: "PaymentEvent",
      eventId: event._id.toString(),
      hostelId: invoice.hostelId,
      invoiceId: invoice._id.toString(),
      source: "RESIDENT_CLAIM",
    });

    await notifyAdminsOfClaim({
      amount: input.amount,
      eventId: event._id.toString(),
      method: input.paymentMethod,
      period: invoice.period ?? null,
      invoiceReference: invoice.referenceCode ?? null,
      referenceNote: input.referenceNote ?? null,
      resident: resident as ResidentRecord,
      transactionCode: input.transactionCode ?? null,
    });

    // Live-refresh every payments panel in this hostel plus the resident's own
    // screens, so the claim reaches the review queue without a reload.
    await publishResourceChange({
      hostelIds: [invoice.hostelId.toString()],
      topics: [REALTIME_TOPIC.PAYMENTS],
      userIds: [principal.userId],
    });
  }

  return { created, eventId: event._id.toString(), status: event.status };
}
