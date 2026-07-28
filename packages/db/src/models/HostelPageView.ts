import { Schema, model, models } from "mongoose";

/**
 * One row per visit to a hostel's public detail page. Two things read it:
 *
 * 1. The hostel admin dashboard — "how many people looked at my listing".
 * 2. The resident-identity prompt — a visitor who has viewed hostels 3+ times is
 *    clearly shopping for a room, which is when we ask them to fill their
 *    profile once instead of at every hostel.
 *
 * Writes are de-duplicated per visitor per hostel inside a short window (see
 * hostel-view.service.ts) so a page refresh does not inflate the count.
 */
const hostelPageViewSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    /** Null for signed-out visitors — `visitorKey` still groups them. */
    userId: { ref: "User", default: null, type: Schema.Types.ObjectId },
    /** Opaque per-browser id from the `hh_visitor` cookie. Not personal data. */
    visitorKey: { type: String, required: true, index: true },
    referrer: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

hostelPageViewSchema.index({ hostelId: 1, createdAt: -1 });
hostelPageViewSchema.index({ hostelId: 1, visitorKey: 1, createdAt: -1 });
hostelPageViewSchema.index({ userId: 1, createdAt: -1 });
hostelPageViewSchema.index({ visitorKey: 1, createdAt: -1 });

export const HostelPageViewModel =
  models.HostelPageView || model("HostelPageView", hostelPageViewSchema);
