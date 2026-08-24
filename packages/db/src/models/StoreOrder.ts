import { Schema, model, models } from "mongoose";

/**
 * A placed supply order: the hostel is the buyer, the platform is the seller.
 *
 * ## Every line is a snapshot, and that is the point
 *
 * `items` copies the name, unit, price and image out of `StoreProduct` at the
 * moment the order is placed. The `productId` survives so the platform can see
 * what sold, but nothing on this document is ever re-read through it. An order
 * is a record of an agreement — if the catalogue price changes tomorrow, or the
 * product is delisted, last month's order still has to print exactly what was
 * agreed, and a serializer that joined back to the live product would silently
 * rewrite history.
 *
 * Money is **NPR paisa** throughout, matching `StoreProduct.price`.
 * `subtotal + deliveryFee = total` is written down rather than derived so a
 * later change to the delivery rule cannot retroactively alter a total.
 *
 * ## Status is a line, not a graph
 *
 * `PLACED → CONFIRMED → PACKED → SHIPPED → DELIVERED`, with `CANCELLED` as the
 * one exit, allowed until the order ships. Each move appends to `timeline`, so
 * the order detail screen reads its own history instead of the audit log —
 * a buyer is entitled to see what happened to their order without anyone
 * granting them access to a privileged trail.
 *
 * ## Payment is cash on delivery, and it is still recorded
 *
 * `paymentMethod` has one member today. It exists as a field anyway because
 * "COD" is a fact about *this* order rather than a fact about the store, and
 * adding eSewa later must not mean backfilling every historical row.
 * `paymentStatus` moves to `PAID` when the courier collects.
 */
const storeOrderSchema = new Schema(
  {
    /** Human-quotable, unique, and never reissued — see `ReceiptCounter`. */
    orderNumber: { required: true, trim: true, type: String, uppercase: true },
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    placedBy: { ref: "User", required: true, type: Schema.Types.ObjectId },
    items: [
      {
        _id: false,
        productId: { ref: "StoreProduct", required: true, type: Schema.Types.ObjectId },
        name: { required: true, trim: true, type: String },
        unit: { default: "piece", trim: true, type: String },
        imageAssetId: { trim: true, type: String },
        imageUrl: { trim: true, type: String },
        /** Paisa, as agreed. Never re-read from the catalogue. */
        unitPrice: { min: 0, required: true, type: Number },
        quantity: { min: 1, required: true, type: Number },
        /** `unitPrice * quantity`, written down for the same reason `total` is. */
        lineTotal: { min: 0, required: true, type: Number },
      },
    ],
    subtotal: { min: 0, required: true, type: Number },
    deliveryFee: { default: 0, min: 0, type: Number },
    total: { min: 0, required: true, type: Number },
    /**
     * Where it goes. Copied off the hostel at placement and then editable on the
     * order, because the hostel's registered address and the gate the delivery
     * should arrive at are not reliably the same place.
     */
    delivery: {
      contactName: { required: true, trim: true, type: String },
      phone: { required: true, trim: true, type: String },
      addressLine: { required: true, trim: true, type: String },
      city: { trim: true, type: String },
      /** "Ring the bell on the left", "after 5pm". Shown to the courier. */
      note: { maxlength: 500, trim: true, type: String },
    },
    paymentMethod: { default: "COD", enum: ["COD"], type: String },
    paymentStatus: {
      default: "PENDING",
      enum: ["PENDING", "PAID", "REFUNDED"],
      type: String,
    },
    status: {
      default: "PLACED",
      enum: ["PLACED", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED"],
      type: String,
    },
    timeline: [
      {
        _id: false,
        status: { required: true, trim: true, type: String },
        note: { maxlength: 500, trim: true, type: String },
        at: { default: Date, type: Date },
        byUserId: { ref: "User", type: Schema.Types.ObjectId },
      },
    ],
    cancelledAt: Date,
    cancelledReason: { maxlength: 500, trim: true, type: String },
    deliveredAt: Date,
  },
  { timestamps: true },
);

storeOrderSchema.index({ orderNumber: 1 }, { unique: true });
// The hostel's own order list, newest first.
storeOrderSchema.index({ hostelId: 1, createdAt: -1 });
// The platform's fulfilment queue.
storeOrderSchema.index({ status: 1, createdAt: -1 });

export const StoreOrderModel = models.StoreOrder || model("StoreOrder", storeOrderSchema);
