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

  const duplicate = await PaymentEventModel.exists({
    evidenceHash: asset.contentHash,
    hostelId,
  });

  if (duplicate) {
    throw new FinanceServiceError(
      "This screenshot has already been submitted for a payment. If this is a different payment, upload the screenshot for that one.",
      "EVIDENCE_ALREADY_USED",
    );
  }
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

  await assertAmountWithinBounds(input.amount, invoice);
  await assertEvidenceNotAlreadyClaimed(asset, invoice.hostelId);

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
    provider: input.paymentMethod === "BANK_TRANSFER" ? "BANK" : input.paymentMethod,
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
      referenceNote: input.referenceNote ?? input.transactionCode ?? null,
      resident: resident as ResidentRecord,
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
