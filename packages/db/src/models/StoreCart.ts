import { Schema, model, models } from "mongoose";

/**
 * The hostel's open basket. Exactly one per hostel, enforced by the unique
 * index — a cart is a place, not an event, and "which of my three carts am I
 * looking at" is not a question a hostel owner should ever be asked.
 *
 * ## The cart holds quantities, never prices
 *
 * A line is a product reference and a number. Nothing here caches the price,
 * the name or the photograph, because a cart that remembered them would show
 * yesterday's price for a week and then charge today's at checkout — the exact
 * discrepancy that makes someone stop trusting a shop. Reads join to
 * `StoreProduct` and quote it live; the snapshot happens once, at the moment an
 * order is placed, and lives on {@link StoreOrderModel} where it belongs.
 *
 * A line whose product has since been deactivated or deleted is therefore not a
 * broken row — the cart read drops it and tells the caller what it dropped.
 *
 * `updatedBy` is who last touched it. The cart belongs to the hostel rather
 * than to a person, so two owners of the same hostel share one basket; the
 * field is there to answer "who added this", not to partition it.
 */
const storeCartSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    items: [
      {
        _id: false,
        productId: { ref: "StoreProduct", required: true, type: Schema.Types.ObjectId },
        quantity: { min: 1, required: true, type: Number },
        addedAt: { default: Date, type: Date },
      },
    ],
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

storeCartSchema.index({ hostelId: 1 }, { unique: true });

export const StoreCartModel = models.StoreCart || model("StoreCart", storeCartSchema);
