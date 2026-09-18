import { Schema, model, models } from "mongoose";

/**
 * A percentage off every resident's rent, for one month only.
 *
 * ## Why this is not on the rate card
 *
 * `FeeSchedule` answers "what does this bed cost", is versioned by effective
 * date and is **never edited**. A Dashain month at half rent is not a new price
 * for the bed — the card is unchanged, and it is the card again next month. Put
 * on the schedule it would mean opening a card for Aswin, another for Kartik at
 * 50%, and a third for Mangsir back at the old rents, with the real rates now
 * spread over three rows that only agree by accident.
 *
 * So this is a thin overlay on top of whatever priced the resident — schedule,
 * listed room rent, or a per-resident override. All three are rent, and a hostel
 * that says "half fee in Dashain" means all of them.
 *
 * ## One row per month, and `percentOff` is what is *taken off*
 *
 * A percentage rather than a rupee figure, because that is how the hostel states
 * it ("Dashain ma aadha") and because one row then applies correctly to a single
 * room and a dormitory bed at once. The stored number is the discount, not the
 * share charged: 50 means the resident pays half.
 *
 * ## Invoices are still snapshots
 *
 * Nothing here is re-derived at read time. The billing run reduces the amount
 * before the invoice is written and names the reason on the line, so deleting
 * this row later cannot change a bill that has already gone out.
 */
const rentConcessionSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    /** A Bikram Sambat month, `YYYY-MM` — `2083-06` is Aswin. */
    period: { type: String, required: true, trim: true },
    /**
     * Whole percent taken off the month's rent, 1–100.
     *
     * Zero is not allowed: a row that discounts nothing is a row that says
     * something was configured when nothing was, and the absence of a row is
     * already how "full rent" is expressed. 100 is allowed — a free month is a
     * real decision some hostels make after a flood.
     */
    percentOff: {
      max: 100,
      min: 1,
      required: true,
      type: Number,
      validate: {
        message: "{PATH} must be a whole percent.",
        validator: Number.isInteger,
      },
    },
    /** Printed on the invoice line, so a resident sees why it is less. */
    reason: { maxlength: 60, trim: true, type: String },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

/** One discount per month per hostel — two would have to be composed somehow. */
rentConcessionSchema.index({ hostelId: 1, period: 1 }, { unique: true });

export const RentConcessionModel =
  models.RentConcession || model("RentConcession", rentConcessionSchema);
