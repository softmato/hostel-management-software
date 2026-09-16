import { Schema, model, models } from "mongoose";

/**
 * The platform's own statutory numbering, one gapless run per fiscal year.
 *
 * `HH-INV-2083/84-000012` and `HH-TXN-2083/84-00000008` — the numbers on the
 * invoices and receipts this platform issues to hostels for their plan, in the
 * fiscal years when Softmato could not issue them itself.
 *
 * ## Why this is not `ReceiptCounter`
 *
 * `ReceiptCounter` is keyed by hostel, and its own comment says why: a global
 * counter would let any hostel read the platform's total volume off two of its
 * own numbers. That reasoning is correct for a hostel's receipts to its
 * residents, and it is the exact opposite of what a statutory series needs.
 *
 * A tax document sequence has to be **one run, in order, with no gaps**, across
 * every customer. That is the property an auditor checks and the reason the
 * number is worth printing at all. Per-hostel numbering would produce a dozen
 * `000001`s in one year and prove nothing about any of them. So the leak is
 * accepted here — a hostel holding two of our invoices can estimate how many
 * plans we sold between them, and that is the cost of a sequence that means
 * something.
 *
 * Two collections rather than one model with a nullable `hostelId`, because a
 * nullable tenant key is the kind of field that is eventually forgotten in a
 * query and silently mixes the two runs together.
 *
 * ## The number is allocated once and stored
 *
 * `$inc` on a single document is atomic, so two invoices raised in the same
 * millisecond get different numbers. What it cannot do is take one back: a
 * process that dies between the increment and the write that stores the number
 * burns it, and the series shows a gap.
 *
 * That is the correct trade and the opposite one is not available. Reusing a
 * burnt number means two documents can carry it — the failed write may have
 * landed — and a duplicated invoice number is a far worse thing to explain than
 * a missing one. A gap says a document was started and abandoned, which is
 * true.
 */

export const PLATFORM_DOCUMENT_KINDS = [
  /** The plan invoice. `HH-INV-2083/84-000012`. */
  "SUBSCRIPTION_INVOICE",
  /** The receipt for money received against one. `HH-TXN-2083/84-00000008`. */
  "SUBSCRIPTION_RECEIPT",
  /** A room booking fee invoice. `HH-BKI-2083/84-000031`. */
  "BOOKING_INVOICE",
  /** The receipt for a booking fee. `HH-BKR-2083/84-00000019`. */
  "BOOKING_RECEIPT",
  /** The note for a booking refund we sent. `HH-BRF-2083/84-00000004`. */
  "BOOKING_REFUND",
  /** The advice for a hostel's share of a booking fee we sent. `HH-BPO-2083/84-00000011`. */
  "BOOKING_PAYOUT",
] as const;

const platformDocumentSequenceSchema = new Schema(
  {
    kind: {
      enum: PLATFORM_DOCUMENT_KINDS,
      required: true,
      type: String,
    },
    /**
     * `2083/84`. The fiscal year the run belongs to, from `bsFiscalYear()`.
     *
     * Stored as the printed label rather than an opening year, so the row is
     * legible to anyone reading the collection and there is no second place
     * that has to know Shrawan opens the year.
     */
    fiscalYear: { required: true, trim: true, type: String },
    /** Last issued value. The next number is this + 1. */
    sequence: { default: 0, min: 0, type: Number },
  },
  { timestamps: true },
);

platformDocumentSequenceSchema.index(
  { kind: 1, fiscalYear: 1 },
  { unique: true },
);

export const PlatformDocumentSequenceModel =
  models.PlatformDocumentSequence ||
  model("PlatformDocumentSequence", platformDocumentSequenceSchema);
