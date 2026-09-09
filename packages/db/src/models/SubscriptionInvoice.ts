import { Schema, model, models } from "mongoose";

import { currencyField, positiveWholeRupees } from "@hostel/db/models/finance-fields";

/**
 * What a hostel owes the platform for a plan.
 *
 * The sibling of `Invoice`, one level up: that one is a hostel billing its
 * resident, this one is the platform billing the hostel. The design rules are
 * the same ones, for the same reasons, and are documented there — the amount is
 * the obligation, it is immutable, and **no `paidAmount` lives on it**. What has
 * been collected is the sum of `SubscriptionPayment` rows pointing here.
 *
 * ## When one is raised
 *
 * Two trigger points, deliberately different:
 *
 * - **Public** — when the owner clicks *Pay now*. Not when they choose a plan,
 *   because choosing is allowed while still unverified and an invoice raised
 *   then would be a demand for money we are not yet willing to take.
 * - **Team** — when the agent moves past the plan step, because the agent is
 *   standing in front of the owner about to collect, and the invoice is the
 *   thing they are collecting against.
 *
 * ## Everything about the plan is copied
 *
 * `planId` is kept for reporting and nothing reads back through it. See
 * `HostelSubscription` for why: the catalogue is editable, and an invoice that
 * re-derived its own total would rewrite an agreement after the fact.
 */

export const SUBSCRIPTION_INVOICE_STATUSES = [
  /** Raised, nothing collected. */
  "OPEN",
  /** Some money in, not all of it. Only reachable on a team registration. */
  "PARTIAL",
  "PAID",
  /** Withdrawn before settling. A wrong invoice is voided, never edited. */
  "VOID",
] as const;

const subscriptionInvoiceSchema = new Schema(
  {
    /** `SUB-2609-0001-4F2A`. Human-quotable, unique, never reissued. */
    invoiceNumber: { required: true, trim: true, type: String, uppercase: true },
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    subscriptionId: {
      ref: "HostelSubscription",
      required: true,
      type: Schema.Types.ObjectId,
    },

    /* ── The plan, snapshotted at issue ────────────────────────────────── */

    planId: { required: true, trim: true, type: String },
    planName: { required: true, trim: true, type: String },
    cycle: {
      enum: ["monthly", "halfYearly", "annual"],
      required: true,
      type: String,
    },
    cycleMonths: { min: 1, required: true, type: Number },
    /** The obligation. Whole rupees, and never zero — see `positiveWholeRupees`. */
    amount: { ...positiveWholeRupees, required: true },
    currency: currencyField,

    status: {
      default: "OPEN",
      enum: SUBSCRIPTION_INVOICE_STATUSES,
      required: true,
      type: String,
    },

    /**
     * Who the document is addressed to, copied at issue.
     *
     * An owner can change the email on their account, and a reissued copy of a
     * six-month-old invoice must still show the address it was sent to.
     */
    billedTo: {
      email: { trim: true, type: String },
      hostelName: { trim: true, type: String },
      name: { trim: true, type: String },
    },

    issuedAt: { default: Date.now, type: Date },
    /** The date the full amount is expected by. */
    dueAt: { default: null, type: Date },

    source: { default: "PUBLIC", enum: ["PUBLIC", "TEAM"], type: String },
    /** The agent who raised it in the field. Null when the owner self-served. */
    agentId: { default: null, ref: "User", type: Schema.Types.ObjectId },

    /* ── The Softmato invoice this one is billed through ───────────── */

    /**
     * The statutory document's own number, e.g. `INV-2083/84-000010`.
     *
     * Two numbers exist for one obligation and both are kept. `invoiceNumber`
     * above is ours: allocated first, quoted by our screens and emails, and
     * what the `external_ref` on their side is derived from. This one carries
     * the fiscal year and the ledger sequence, is issued under the parent
     * company's name and PAN, and is what an accountant will ask about.
     *
     * Null means the obligation is recorded and the paper has not been raised
     * yet — a real, resumable state, not a defect. It is reached whenever the
     * API was unreachable at issue time, and the next attempt to pay raises it.
     */
    softmatoInvoiceNo: { default: null, trim: true, type: String },
    /** Their opaque id. What `POST /v1/checkout` is addressed by. */
    softmatoInvoiceId: { default: null, trim: true, type: String },

    /**
     * The rendered document, on their side.
     *
     * Null until the invoice is raised there, which is the honest
     * representation of "no PDF exists yet" — a placeholder URL would be a
     * dead link on an email claiming to carry an invoice.
     */
    documentUrl: { default: null, trim: true, type: String },

    voidedAt: { default: null, type: Date },
    voidedBy: { default: null, ref: "User", type: Schema.Types.ObjectId },
    voidReason: { default: null, trim: true, type: String },
  },
  { timestamps: true },
);

subscriptionInvoiceSchema.index({ invoiceNumber: 1 }, { unique: true });
subscriptionInvoiceSchema.index({ hostelId: 1, status: 1, createdAt: -1 });
subscriptionInvoiceSchema.index({ status: 1, dueAt: 1 });
subscriptionInvoiceSchema.index({ agentId: 1, createdAt: -1 });
// The handle a webhook arrives carrying. Partial, because the number is only
// assigned once the invoice has actually been raised on their side.
subscriptionInvoiceSchema.index(
  { softmatoInvoiceNo: 1 },
  {
    partialFilterExpression: { softmatoInvoiceNo: { $type: "string" } },
    unique: true,
  },
);

export const SubscriptionInvoiceModel =
  models.SubscriptionInvoice ||
  model("SubscriptionInvoice", subscriptionInvoiceSchema);
