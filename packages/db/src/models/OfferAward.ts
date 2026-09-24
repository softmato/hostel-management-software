import { Schema, model, models } from "mongoose";

/**
 * A Resident Offer Program perk given to one resident for one quarter.
 *
 * **One per resident per quarter**, by index: the programme rewards a quarter of
 * certified payments, and two awards for the same quarter would be a
 * double-click, not a decision.
 *
 * Lifecycle:
 *
 * - `AWARDED` — given. A `FEE_OFF` sits here until the resident has a monthly
 *   invoice to take it off; the billing run applies it the moment one is issued.
 * - `APPLIED` — `FEE_OFF` only: HostelPalika's payment is on the invoice.
 *   `hostelPaidAt` then records when the platform settled that money with the
 *   hostel, which is the only part of this the ledger cannot see.
 * - `DELIVERED` — `GIFT` only: handed over.
 * - `CANCELLED` — withdrawn before it was used.
 */
const offerAwardSchema = new Schema(
  {
    perkId: { ref: "OfferPerk", required: true, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", required: true, type: Schema.Types.ObjectId },
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    userId: { ref: "User", default: null, type: Schema.Types.ObjectId },
    /** `2083-Q2` — Shrawan to Aswin 2083. */
    quarter: { required: true, trim: true, type: String },

    // Snapshot of the perk at award time.
    title: { required: true, trim: true, type: String },
    kind: { enum: ["FEE_OFF", "GIFT"], required: true, type: String },
    percentOff: { default: null, type: Number },

    status: {
      default: "AWARDED",
      enum: ["AWARDED", "APPLIED", "DELIVERED", "CANCELLED"],
      type: String,
    },

    appliedInvoiceId: { ref: "Invoice", default: null, type: Schema.Types.ObjectId },
    appliedEventId: { ref: "PaymentEvent", default: null, type: Schema.Types.ObjectId },
    appliedAmount: { default: null, type: Number },
    appliedAt: { default: null, type: Date },
    hostelPaidAt: { default: null, type: Date },
    deliveredAt: { default: null, type: Date },
    cancelledAt: { default: null, type: Date },

    note: { maxlength: 300, trim: true, type: String },
    awardedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

offerAwardSchema.index({ quarter: 1, residentId: 1 }, { unique: true });
offerAwardSchema.index({ residentId: 1, createdAt: -1 });
offerAwardSchema.index({ kind: 1, residentId: 1, status: 1 });

export const OfferAwardModel = models.OfferAward || model("OfferAward", offerAwardSchema);
