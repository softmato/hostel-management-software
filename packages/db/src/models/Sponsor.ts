import { Schema, model, models } from "mongoose";

/**
 * A paid placement in the community's right-hand rail — a college, a hostel, a
 * local business. Created and ordered by the platform owner only; nothing in
 * the hostel or resident portals can write one.
 *
 * Ordering is `priority` descending, newest first inside a tie. A higher number
 * wins, so a new top slot never requires renumbering everything below it.
 *
 * `startsAt`/`endsAt` are the campaign window. Both are optional: a sponsor
 * with neither runs until someone deactivates it, which is the common case for
 * an ongoing partnership.
 */
const sponsorSchema = new Schema(
  {
    name: { maxlength: 120, required: true, trim: true, type: String },
    /** Shown under the name, e.g. "Baneshwor, Kathmandu" or "Engineering". */
    subtitle: { maxlength: 160, trim: true, type: String },
    kind: {
      default: "COLLEGE",
      enum: ["COLLEGE", "HOSTEL", "BUSINESS", "OTHER"],
      type: String,
    },
    /**
     * The banner. `imageAssetId` goes through the normal upload pipeline;
     * `imageUrl` covers a sponsor who hands over a hosted asset instead. When
     * neither is set the card falls back to the name on a coloured block, which
     * is why `accentColor` exists.
     */
    imageAssetId: { trim: true, type: String },
    imageUrl: { trim: true, type: String },
    accentColor: { default: "#0a8a4b", trim: true, type: String },
    /** Where the card goes when clicked. External links open in a new tab. */
    linkUrl: { maxlength: 500, trim: true, type: String },
    ctaLabel: { default: "View", maxlength: 40, trim: true, type: String },
    /** Free-text line above the CTA, e.g. "NPR 9,500/mo" or "Admissions open". */
    highlight: { maxlength: 80, trim: true, type: String },
    priority: { default: 0, type: Number },
    isActive: { default: true, type: Boolean },
    startsAt: Date,
    endsAt: Date,
    /** Impressions are counted per feed render, clicks per card click. */
    impressionCount: { default: 0, min: 0, type: Number },
    clickCount: { default: 0, min: 0, type: Number },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
    /** Seeded sample content — see CommunityPost. */
    isDemoData: { default: false, type: Boolean },
  },
  { timestamps: true },
);

// The rail's only read: active sponsors, best priority first.
sponsorSchema.index({ isActive: 1, priority: -1, createdAt: -1 });

export const SponsorModel = models.Sponsor || model("Sponsor", sponsorSchema);
