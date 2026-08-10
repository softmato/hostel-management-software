import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { auditFinanceAction } from "@/modules/finance/audit-finance";
import { FinanceServiceError } from "@/modules/finance/finance.errors";
import { FileAssetModel } from "@hostel/db/models/FileAsset";
import {
  HostelPaymentProfileModel,
  isPaymentProfileUsable,
  resolvePaymentTier,
  type PaymentTier,
} from "@hostel/db/models/HostelPaymentProfile";

import type { PaymentProfileUpdateInput } from "./payment-profile.validation";

/**
 * The payment profile screen's service (target §11.8, plan item 3.1).
 *
 * This closes current §7.11: there was nowhere to record how a hostel takes
 * money, so the product asked residents for proof of a payment it gave them no
 * instructions for. Everything the resident pay screen (3.3) renders is read
 * from here, which is why `usable` is computed on the way out — a profile with a
 * display name and nothing else is an empty form, and the resident has to be
 * told that rather than shown a blank card.
 */

export type PaymentProfileView = {
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
  cashApprovalThreshold: number;
  displayName: string | null;
  esewaId: string | null;
  /** Whether Fonepay/eSewa/Khalti checkout is live. Derived, never stored. */
  gatewayProvider: string | null;
  khaltiId: string | null;
  lastStatementUploadAt: string | null;
  paymentInstructions: string | null;
  staticQrAssetId: string | null;
  statementCadenceDays: number;
  tier: PaymentTier;
  /** False means the resident pay screen must say "not set up yet". */
  usable: boolean;
};

type ProfileDocument = {
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankName?: string | null;
  cashApprovalThreshold?: number;
  displayName?: string | null;
  esewaId?: string | null;
  gatewayEnabledAt?: Date | null;
  gatewayProvider?: string | null;
  khaltiId?: string | null;
  lastStatementUploadAt?: Date | null;
  paymentInstructions?: string | null;
  staticQrAssetId?: Types.ObjectId | null;
  statementCadenceDays?: number;
};

/** The shape every read returns for a hostel that has never opened the form. */
const EMPTY: ProfileDocument = {};

function toView(profile: ProfileDocument | null): PaymentProfileView {
  const source = profile ?? EMPTY;

  return {
    bankAccountName: source.bankAccountName ?? null,
    bankAccountNumber: source.bankAccountNumber ?? null,
    bankName: source.bankName ?? null,
    cashApprovalThreshold: source.cashApprovalThreshold ?? 20000,
    displayName: source.displayName ?? null,
    esewaId: source.esewaId ?? null,
    gatewayProvider: source.gatewayProvider ?? null,
    khaltiId: source.khaltiId ?? null,
    lastStatementUploadAt: source.lastStatementUploadAt
      ? new Date(source.lastStatementUploadAt).toISOString()
      : null,
    paymentInstructions: source.paymentInstructions ?? null,
    staticQrAssetId: source.staticQrAssetId
      ? source.staticQrAssetId.toString()
      : null,
    statementCadenceDays: source.statementCadenceDays ?? 7,
    tier: resolvePaymentTier(source),
    usable: isPaymentProfileUsable(source),
  };
}

export async function getPaymentProfile(
  hostelId: Types.ObjectId | string,
): Promise<PaymentProfileView> {
  await connectToDatabase();

  return toView(
    await HostelPaymentProfileModel.findOne({ hostelId }).lean<ProfileDocument | null>(),
  );
}

/**
 * The QR is a *financial* asset (item 0.1), so it carries a `hostelId` and this
 * hostel's must match. Without the check an owner could paste any asset id and
 * publish another hostel's QR on their own pay screen — which is not a leak of
 * data so much as a redirection of money.
 */
async function assertQrAssetUsable(
  assetId: string,
  hostelId: Types.ObjectId | string,
) {
  const asset = Types.ObjectId.isValid(assetId)
    ? await FileAssetModel.findOne({
        _id: assetId,
        isDeleted: false,
        status: "ACTIVE",
      }).lean<{
        _id: Types.ObjectId;
        hostelId?: Types.ObjectId;
        uploadCompletedAt?: Date;
      } | null>()
    : null;

  if (!asset || asset.hostelId?.toString() !== hostelId.toString()) {
    throw new FinanceServiceError(
      "That image does not belong to this hostel. Upload the QR again.",
      "ASSET_NOT_OWNED",
    );
  }

  if (!asset.uploadCompletedAt) {
    throw new FinanceServiceError(
      "That image did not finish uploading. Please upload the QR again.",
      "ASSET_UPLOAD_INCOMPLETE",
    );
  }

  return asset._id;
}

/** Field names the form may write, so an unexpected key cannot reach the update. */
const TEXT_FIELDS = [
  "bankAccountName",
  "bankAccountNumber",
  "bankName",
  "displayName",
  "esewaId",
  "khaltiId",
  "paymentInstructions",
] as const;

export async function updatePaymentProfile(
  hostelId: Types.ObjectId | string,
  input: PaymentProfileUpdateInput,
  principal: ApiPrincipal,
): Promise<PaymentProfileView> {
  await connectToDatabase();

  const before = await HostelPaymentProfileModel.findOne({
    hostelId,
  }).lean<ProfileDocument | null>();

  const update: Record<string, unknown> = { updatedBy: principal.userId };

  for (const field of TEXT_FIELDS) {
    if (input[field] !== undefined) update[field] = input[field];
  }

  if (input.cashApprovalThreshold !== undefined) {
    update.cashApprovalThreshold = input.cashApprovalThreshold;
  }

  if (input.statementCadenceDays !== undefined) {
    update.statementCadenceDays = input.statementCadenceDays;
  }

  if (input.staticQrAssetId !== undefined) {
    update.staticQrAssetId = input.staticQrAssetId
      ? await assertQrAssetUsable(input.staticQrAssetId, hostelId)
      : null;
  }

  const saved = await HostelPaymentProfileModel.findOneAndUpdate(
    { hostelId },
    { $set: update, $setOnInsert: { createdBy: principal.userId, hostelId } },
    { new: true, upsert: true },
  ).lean<ProfileDocument | null>();

  // The threshold is the one *amount* on this form, and changing it changes who
  // may release money without a second person — so it is the before/after the
  // audit envelope (§5.3) requires. Everything else on the profile is text.
  await auditFinanceAction(principal, {
    action: "PAYMENT_PROFILE_UPDATED",
    amountAfter: saved?.cashApprovalThreshold ?? 20000,
    amountBefore: before?.cashApprovalThreshold ?? 20000,
    entityId: new Types.ObjectId(String(hostelId)),
    entityType: "HostelPaymentProfile",
    hostelId,
    source: "PAYMENT_PROFILE_EDITOR",
  });

  return toView(saved);
}
