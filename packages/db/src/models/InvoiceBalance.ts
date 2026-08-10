import { Schema, model, models } from "mongoose";

/**
 * A read model over `PaymentEvent`, so a page load does not sum the event log
 * (target §4.1).
 *
 * **This is a cache and must be treated as one.** It is rebuilt from the events
 * by the reconciliation job, and any disagreement between it and the event sum
 * is a `LEDGER_DRIFT` finding — never a silent overwrite, because a drift means
 * something wrote where it should not have (target §10.1). The events are the
 * truth; this is only faster.
 */

const invoiceBalanceSchema = new Schema(
  {
    invoiceId: {
      ref: "Invoice",
      required: true,
      type: Schema.Types.ObjectId,
      unique: true,
    },
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", type: Schema.Types.ObjectId },
    /** sum(SETTLED CREDIT) − sum(SETTLED DEBIT). May legitimately exceed the invoice. */
    settledAmount: {
      default: 0,
      type: Number,
      validate: {
        message: "{PATH} must be a whole number of rupees.",
        validator: Number.isInteger,
      },
    },
    /** The most recent event folded in, for cheap staleness checks. */
    lastEventId: { ref: "PaymentEvent", type: Schema.Types.ObjectId },
    lastComputedAt: { type: Date, default: Date.now },
    /** Increments on every recompute, so a lost update is visible. */
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);

invoiceBalanceSchema.index({ hostelId: 1, lastComputedAt: -1 });

export const InvoiceBalanceModel =
  models.InvoiceBalance || model("InvoiceBalance", invoiceBalanceSchema);
