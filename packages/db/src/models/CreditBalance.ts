import { Schema, model, models } from "mongoose";

import { currencyField, wholeRupees } from "@hostel/db/models/finance-fields";

/**
 * Money a resident has paid that no invoice has consumed yet (target §9.4).
 *
 * Exists because of a rule stated plainly in the target doc: **never destroy
 * money.** A resident who pays 15,000 against a 12,000 invoice has not made a
 * 12,000 payment — they have made a 15,000 payment, and the 3,000 has to go
 * somewhere nameable. Before this it went nowhere: the balance simply exceeded
 * the total and no screen ever mentioned it again.
 *
 * **`amount` is derived, not incremented** — recomputed from `entries` on every
 * write, exactly as `InvoiceBalance.settledAmount` is recomputed from the events
 * (P3, ADR-3). An increment can drift under a retry; a recomputation cannot, and
 * the drift job can therefore check this the same way it checks an invoice.
 *
 * `entries` is append-only and each entry carries the event or invoice that
 * caused it, so "why do I have 3,000 in credit" has an answer with a date on it.
 */

const creditEntrySchema = new Schema(
  {
    /**
     * `EARNED` — an overpayment settled and left change.
     * `APPLIED` — a later invoice consumed some of it, as a negative line.
     * `REFUNDED` — paid back at move-out (target §9.4).
     */
    kind: {
      type: String,
      enum: ["EARNED", "APPLIED", "REFUNDED"],
      required: true,
    },
    /** Always positive; `kind` carries the sign. */
    amount: { ...wholeRupees, required: true },
    /** The overpayment that earned it, or null. */
    eventId: { ref: "PaymentEvent", default: null, type: Schema.Types.ObjectId },
    /** The invoice that earned or consumed it. */
    invoiceId: { ref: "Invoice", default: null, type: Schema.Types.ObjectId },
    /**
     * Deterministic, and unique within this resident's entries — see the index
     * below. What makes crediting an overpayment safe to re-run.
     */
    idempotencyKey: { type: String, required: true, trim: true },
    occurredAt: { default: Date.now, type: Date },
    note: { type: String, trim: true },
  },
  { _id: false },
);

const creditBalanceSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", required: true, type: Schema.Types.ObjectId },

    /** `sum(EARNED) − sum(APPLIED) − sum(REFUNDED)`. Never typed by a human. */
    amount: { ...wholeRupees, default: 0 },
    currency: currencyField,

    entries: { type: [creditEntrySchema], default: [] },
    lastComputedAt: Date,
  },
  { timestamps: true },
);

/** One balance per resident per hostel — credit does not cross a tenant line. */
creditBalanceSchema.index({ hostelId: 1, residentId: 1 }, { unique: true });
/** Drives the owner's "who is holding credit" view and the drift check. */
creditBalanceSchema.index(
  { hostelId: 1, amount: -1 },
  { partialFilterExpression: { amount: { $gt: 0 } } },
);
/**
 * The idempotency guarantee, at the storage layer rather than in a service that
 * has to remember: two entries with the same key cannot coexist on one balance.
 */
creditBalanceSchema.index(
  { residentId: 1, "entries.idempotencyKey": 1 },
  { unique: true, sparse: true },
);

/** `sum(EARNED) − sum(APPLIED) − sum(REFUNDED)`, in whole rupees. */
export function computeCreditAmount(
  entries: { amount: number; kind: string }[],
): number {
  return entries.reduce(
    (total, entry) => total + (entry.kind === "EARNED" ? entry.amount : -entry.amount),
    0,
  );
}

export const CreditBalanceModel =
  models.CreditBalance || model("CreditBalance", creditBalanceSchema);
