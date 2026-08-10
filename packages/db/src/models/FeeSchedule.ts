import { Schema, model, models } from "mongoose";

/**
 * The hostel's rate card, versioned by effective date (target §3.3).
 *
 * Replaces `Resident.monthlyFee` as the source of what a resident is charged.
 * That field was a bare number set per resident or bulk-set across a whole
 * hostel, with no history — so "what was this resident's rent in March?" had no
 * answer, and a bulk change silently rewrote the basis for every future bill.
 *
 * **A schedule is never edited.** Changing rates closes the current row
 * (`effectiveTo` = the day before the new one starts) and inserts a new one.
 * Invoices snapshot the amount they were computed from and do not re-derive it,
 * so a historical invoice stays correct even if every schedule is later deleted.
 */

/** Whole NPR rupees, always (ADR-1). A fraction here is a bug upstream. */
const wholeRupees = {
  min: 0,
  type: Number,
  validate: {
    message: "{PATH} must be a whole number of rupees.",
    validator: Number.isInteger,
  },
};

const rateSchema = new Schema(
  {
    bedType: {
      type: String,
      enum: [
        "SINGLE",
        "DOUBLE_SHARING",
        "TRIPLE_SHARING",
        "FOUR_SHARING",
        "DORMITORY",
      ],
      required: true,
    },
    monthlyAmount: { ...wholeRupees, required: true },
    currency: { type: String, default: "NPR" },
  },
  { _id: false },
);

const feeScheduleSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    effectiveFrom: { type: Date, required: true },
    /** Null means "current". Exactly one row per hostel may be open. */
    effectiveTo: { type: Date, default: null },
    /** One entry per bed type the hostel actually offers. */
    rates: { type: [rateSchema], default: [] },
    /** One-time charge at move-in. Optional — many hostels do not levy one. */
    admissionFee: { ...wholeRupees },
    /** Refundable security deposit. */
    depositAmount: { ...wholeRupees },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

feeScheduleSchema.index({ hostelId: 1, effectiveFrom: -1 });

/**
 * At most one open schedule per hostel. This is what makes "the current rate
 * card" a single well-defined document rather than whichever row a sort happened
 * to return first — the ambiguity that made two billing paths disagree.
 */
feeScheduleSchema.index(
  { hostelId: 1 },
  { partialFilterExpression: { effectiveTo: null }, unique: true },
);

export const FeeScheduleModel =
  models.FeeSchedule || model("FeeSchedule", feeScheduleSchema);
