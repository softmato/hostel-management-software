import { Schema, model, models } from "mongoose";

/**
 * A field agent's wallet, as a ledger: every row is money in (`COMMISSION`) or
 * money out (`PAYOUT`), and the balance is their difference, summed on read.
 *
 * A `COMMISSION` row is written once, when a hostel the agent registered pays
 * its first plan in full — the rate and the base it was worked out from are
 * copied onto the row, so a later change to the configured rate never rewrites
 * what somebody has already earned. The partial unique index on
 * `subscriptionId` is what makes it "first registration only": a renewal, or a
 * webhook delivered twice, cannot credit the same hostel again.
 *
 * Amounts are rupees to the paisa (11.12% of a round plan price is rarely a
 * whole number); `PAYOUT` rows are recorded by a superadmin.
 */
const teamWalletEntrySchema = new Schema(
  {
    agentId: { index: true, ref: "User", required: true, type: Schema.Types.ObjectId },
    type: { enum: ["COMMISSION", "PAYOUT"], required: true, type: String },
    amount: { min: 0, required: true, type: Number },

    // COMMISSION
    hostelId: { ref: "Hostel", type: Schema.Types.ObjectId },
    subscriptionId: { ref: "HostelSubscription", type: Schema.Types.ObjectId },
    invoiceId: { ref: "SubscriptionInvoice", type: Schema.Types.ObjectId },
    base: { min: 0, type: Number },
    ratePercent: { min: 0, type: Number },

    // PAYOUT
    method: { enum: ["CASH", "BANK", "ESEWA", "KHALTI", "OTHER"], type: String },
    reference: { trim: true, type: String },
    note: { trim: true, type: String },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

teamWalletEntrySchema.index(
  { subscriptionId: 1 },
  { partialFilterExpression: { type: "COMMISSION" }, unique: true },
);
teamWalletEntrySchema.index({ agentId: 1, createdAt: -1 });

export const TeamWalletEntryModel =
  models.TeamWalletEntry || model("TeamWalletEntry", teamWalletEntrySchema);
