import { Schema, model, models } from "mongoose";

/**
 * One attempt to pay an invoice through a gateway (target §6.5, plan item 6.2).
 *
 * Separate from `PaymentEvent` because the two answer different questions and
 * conflating them is how a checkout ends up settling money it should not. An
 * intent records that a resident *started* paying — most of them end in nothing,
 * because abandoning a checkout is the single most common outcome of opening
 * one. An event records money. An intent produces an event only after the
 * provider has been asked directly and agreed, which is why `settledEventId` is
 * null for the whole life of most rows here.
 *
 * Keeping abandoned attempts out of `PaymentEvent` also keeps the ledger's
 * meaning intact: every row there is money someone believes moved, and a
 * collection where nine in ten rows are noise is one nobody reads carefully.
 */

const paymentIntentSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", required: true, type: Schema.Types.ObjectId },
    invoiceId: { ref: "Invoice", required: true, type: Schema.Types.ObjectId },

    provider: {
      type: String,
      enum: ["ESEWA", "FONEPAY", "KHALTI"],
      required: true,
    },
    /**
     * Which environment this attempt was made against.
     *
     * Recorded per attempt rather than read from configuration afterwards: a
     * hostel that switches from sandbox to live must not retroactively relabel
     * the test payments it made on the way, and an auditor asking "was this real
     * money" needs an answer that does not depend on today's settings.
     */
    mode: { type: String, enum: ["LIVE", "SANDBOX"], required: true },

    /**
     * The merchant reference we gave the provider — `{referenceCode}-{attempt}`.
     *
     * Not the bare reference code. Providers reject a repeated merchant
     * reference, so a resident who abandons a checkout and tries again would be
     * unable to pay at all. The suffix makes each retry a new transaction to
     * them while staying traceable to one invoice for us.
     */
    reference: { type: String, required: true, trim: true },
    /** Which retry this is, from 1. Part of `reference` and of the idempotency key. */
    attempt: { type: Number, required: true, min: 1 },
    /** What we asked for, in whole rupees. The verification must match it exactly. */
    amount: { type: Number, required: true, min: 1 },

    /**
     * `CREATED` — handed to the provider, nothing heard back.
     * `SUCCEEDED` — the provider was asked directly and agreed. Money moved.
     * `FAILED` — the provider was asked and said no.
     * `EXPIRED` — the window closed with no answer. Swept, never assumed.
     */
    status: {
      type: String,
      enum: ["CREATED", "SUCCEEDED", "FAILED", "EXPIRED"],
      default: "CREATED",
      required: true,
    },
    /** The provider's own transaction id, once they issue one. */
    providerTxnId: { type: String, default: null, trim: true },
    /** When the attempt stops being payable. Drives the countdown and the sweep. */
    expiresAt: { type: Date, required: true },
    /** When we last asked the provider what happened, whatever they said. */
    lastVerifiedAt: Date,
    /** How many times we have asked. A runaway poll is visible here. */
    verifyCount: { type: Number, default: 0 },
    /**
     * The ledger row this attempt produced, if any.
     *
     * The only link between an intent and money. Its presence is what makes
     * re-verifying a settled attempt a no-op rather than a second credit.
     */
    settledEventId: { ref: "PaymentEvent", default: null, type: Schema.Types.ObjectId },
    /**
     * Why this attempt did not settle, when it did not.
     *
     * Written for the cases that need explaining to a human — a verification the
     * provider refused, or one whose amount disagreed with what we asked for.
     * The second is the interesting one: it means the resident was charged
     * something other than what we showed them, and somebody has to look.
     */
    failureReason: { type: String, trim: true },

    createdBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

/**
 * One row per merchant reference, per hostel.
 *
 * The reference is what the provider echoes back in every callback, so a
 * duplicate would make "which attempt is this callback about" unanswerable.
 */
paymentIntentSchema.index({ hostelId: 1, reference: 1 }, { unique: true });
/** The expiry sweep's query: everything still open and past its window. */
paymentIntentSchema.index({ status: 1, expiresAt: 1 });
/** The resident's screen, and the owner's live feed. */
paymentIntentSchema.index({ invoiceId: 1, createdAt: -1 });
/**
 * Resolving a callback that carries the provider's id but not our reference.
 * Sparse, because most rows never receive one.
 */
paymentIntentSchema.index(
  { hostelId: 1, provider: 1, providerTxnId: 1 },
  { partialFilterExpression: { providerTxnId: { $type: "string" } } },
);

export const PaymentIntentModel =
  models.PaymentIntent || model("PaymentIntent", paymentIntentSchema);
