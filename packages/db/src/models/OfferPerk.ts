import { Schema, model, models } from "mongoose";

/**
 * One item in the Resident Offer Program catalogue — what a certified resident
 * can be given at the end of a quarter. The platform owner writes these; the
 * resident screens list the active ones the way a student pack lists its perks.
 *
 * Two kinds, because those are the two things HostelPalika hands out:
 *
 * - `FEE_OFF` — a share of the resident's next monthly fee, paid by HostelPalika
 *   to the hostel on the resident's behalf. `percentOff` is what is taken off.
 * - `GIFT` — something physical or digital, delivered by the platform team.
 *
 * An award snapshots the perk's title and terms, so editing or retiring a perk
 * never rewrites what somebody was already given.
 */
const offerPerkSchema = new Schema(
  {
    title: { maxlength: 80, required: true, trim: true, type: String },
    description: { maxlength: 300, trim: true, type: String },
    kind: { enum: ["FEE_OFF", "GIFT"], required: true, type: String },
    /** FEE_OFF only: whole percent of the next monthly fee, 1–100. */
    percentOff: { max: 100, min: 1, type: Number },
    /** GIFT only, optional: what it is worth, in whole rupees, for the listing. */
    giftValue: { min: 0, type: Number },
    /** Who provides it. Blank means HostelPalika itself. */
    partner: { maxlength: 80, trim: true, type: String },
    imageUrl: { maxlength: 500, trim: true, type: String },
    isActive: { default: true, type: Boolean },
    /** Lower shows first. */
    sortOrder: { default: 0, type: Number },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

offerPerkSchema.index({ isActive: 1, sortOrder: 1 });

export const OfferPerkModel = models.OfferPerk || model("OfferPerk", offerPerkSchema);
