import { Schema, model, models } from "mongoose";

/**
 * How often a hostel was **shown** in public search results — one row per hostel
 * per Nepal day, holding a running count.
 *
 * The sibling of `HostelPageView`, and deliberately not the same shape. A page
 * view is one person opening one listing, and it is worth a row each because the
 * visitor key on it answers "how many distinct people looked". An appearance is
 * the hostel's card being in a result list, and one browse request puts up to
 * sixty of them on screen at once — a row per appearance would be sixty inserts
 * per search to answer a question that only ever wants a sum.
 *
 * So the counter is bucketed by day: one upsert per hostel per request, a unique
 * `(hostelId, day)` key, and a report reads a month by summing thirty rows at most.
 *
 * `day` is `YYYY-MM-DD` in Nepal time, so a bucket boundary is the hostel's
 * midnight rather than UTC's, and a string range covers a month without dates.
 */
const hostelListingImpressionSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    day: { required: true, trim: true, type: String },
    count: { default: 0, min: 0, type: Number },
  },
  { timestamps: false },
);

hostelListingImpressionSchema.index({ hostelId: 1, day: 1 }, { unique: true });

export const HostelListingImpressionModel =
  models.HostelListingImpression ||
  model("HostelListingImpression", hostelListingImpressionSchema);
