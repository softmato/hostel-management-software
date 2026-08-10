import { Schema, model, models } from "mongoose";

/**
 * How residents pay this hostel (target §4.1, fixes current §7.11).
 *
 * There was nowhere in the schema to record a hostel's eSewa ID, bank account or
 * payment QR — the product asked residents for proof of a payment it gave them
 * no instructions for, and every hostel communicated that out of band.
 *
 * One profile per hostel (target §16.5): merchant and bank accounts belong to a
 * legal entity, and reference-code prefixes are per hostel, so an owner with
 * three hostels has three profiles.
 */

const hostelPaymentProfileSchema = new Schema(
  {
    hostelId: {
      ref: "Hostel",
      required: true,
      type: Schema.Types.ObjectId,
      unique: true,
    },
    /** Shown on the resident's pay screen, and must match the QR's registered name. */
    displayName: { type: String, trim: true },

    // ---- Tier 0. At least one of these makes the profile usable. ----
    staticQrAssetId: { ref: "FileAsset", type: Schema.Types.ObjectId },
    esewaId: { type: String, trim: true },
    khaltiId: { type: String, trim: true },
    bankName: { type: String, trim: true },
    bankAccountName: { type: String, trim: true },
    bankAccountNumber: { type: String, trim: true },
    /** Free text shown under the QR, e.g. "please add your room number". */
    paymentInstructions: { type: String, trim: true },

    // ---- Tier 1. Declared now, unused until Block 6. ----
    gatewayProvider: {
      type: String,
      enum: ["FONEPAY", "ESEWA", "KHALTI", null],
      default: null,
    },
    gatewayMerchantCode: { type: String, trim: true },
    /**
     * Reference into `EncryptedSecret` (ADR-6) — **never the secret itself.**
     * A profile is read on every resident pay screen; a secret stored here would
     * be pulled into every one of those requests.
     */
    gatewaySecretRef: { type: String, trim: true },
    gatewayWebhookSecretRef: { type: String, trim: true },
    gatewayEnabledAt: Date,
    /** Drives gateway health: silence here plus open invoices is a warning. */
    gatewayLastEventAt: Date,

    /**
     * Cash above this needs a second approver (target §9.1). Per hostel because
     * NPR 20,000 is a routine month's rent in one hostel and a red flag in
     * another — a platform-wide number would be wrong for everybody. Zero means
     * every cash entry needs two people; a hostel that wants none sets it high
     * deliberately, which is a decision on the record rather than a default.
     */
    cashApprovalThreshold: { default: 20000, min: 0, type: Number },

    // ---- Statement import (Tier 0.5) ----
    lastStatementUploadAt: Date,
    statementCadenceDays: { type: Number, default: 7, min: 1 },

    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

export type PaymentTier = "TIER_0" | "TIER_1";

/**
 * Tier is **derived, never stored** (target §4.1).
 *
 * A stored column can disagree with reality — a hostel whose gateway was
 * disabled but whose `tier` column still said TIER_1 would send residents to a
 * dead payment screen. Deriving it means the two cannot drift apart. Rollback
 * for Block 6 is exactly this: clear `gatewayEnabledAt` and the hostel falls
 * back to Tier 0, which stays fully functional.
 *
 * Exported as a plain function because virtuals do not survive `.lean()`, and
 * every read path in this codebase is lean. One definition, both call styles.
 */
export function resolvePaymentTier(
  profile: {
    gatewayEnabledAt?: Date | null;
    gatewayProvider?: string | null;
  } | null,
): PaymentTier {
  return profile?.gatewayProvider && profile.gatewayEnabledAt
    ? "TIER_1"
    : "TIER_0";
}

/**
 * Whether residents can actually be told how to pay. A profile with no QR, no
 * wallet id and no bank account is an empty form, not a payment method — the
 * resident pay screen must say "your hostel has not set this up yet" rather than
 * render a blank card.
 */
export function isPaymentProfileUsable(
  profile: {
    bankAccountNumber?: string | null;
    esewaId?: string | null;
    khaltiId?: string | null;
    staticQrAssetId?: unknown;
  } | null,
): boolean {
  return Boolean(
    profile &&
    (profile.staticQrAssetId ||
      profile.esewaId ||
      profile.khaltiId ||
      profile.bankAccountNumber),
  );
}

hostelPaymentProfileSchema.virtual("tier").get(function tierVirtual(this: {
  gatewayEnabledAt?: Date | null;
  gatewayProvider?: string | null;
}) {
  return resolvePaymentTier(this);
});

hostelPaymentProfileSchema.set("toJSON", { virtuals: true });
hostelPaymentProfileSchema.set("toObject", { virtuals: true });

export const HostelPaymentProfileModel =
  models.HostelPaymentProfile ||
  model("HostelPaymentProfile", hostelPaymentProfileSchema);
