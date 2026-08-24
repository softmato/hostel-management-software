import { Schema, model, models } from "mongoose";

/**
 * One thing a hostel can buy from the platform's supply store.
 *
 * The platform is the seller and every hostel is a customer of the same
 * catalogue, so — like {@link StoreCategoryModel} — there is deliberately no
 * `hostelId` here. Per-hostel shops would be a different product with a
 * different tenancy story; this one has exactly one shopkeeper.
 *
 * ## Money is stored in paisa, as an integer
 *
 * `price` is **NPR paisa**, not rupees. Every line total, subtotal and order
 * total downstream is integer arithmetic on this number, so a cart of 37 items
 * cannot drift by a hundredth of a rupee the way repeated float multiplication
 * does. The phone divides by 100 exactly once, at the point of drawing.
 *
 * `compareAtPrice` is the struck-through "was" figure. It is not a discount
 * engine — nothing computes from it, it only renders — so a product on offer
 * carries the real price in `price` and the old one here, and never the reverse.
 *
 * ## Stock is a number, and it is authoritative at order time
 *
 * `stockQuantity` is decremented when an order is placed, inside the same
 * conditional update that reserves it, so two hostels racing for the last three
 * mattresses cannot both win. A product with `trackStock: false` skips that
 * entirely — a made-to-order desk has no shelf to run empty.
 */
const storeProductSchema = new Schema(
  {
    name: { maxlength: 160, required: true, trim: true, type: String },
    slug: { lowercase: true, maxlength: 180, required: true, trim: true, type: String },
    /** Long copy for the detail screen. Plain text; the phone renders no markup. */
    description: { maxlength: 4000, trim: true, type: String },
    /** Short line under the name in a list row — "Cotton, 3 inch, single". */
    summary: { maxlength: 200, trim: true, type: String },
    categoryId: { ref: "StoreCategory", required: true, type: Schema.Types.ObjectId },
    /** What one unit is: "piece", "kg", "dozen", "litre". Printed beside the price. */
    unit: { default: "piece", maxlength: 24, trim: true, type: String },
    /** NPR **paisa**. See the note above — never rupees, never a float. */
    price: { min: 0, required: true, type: Number },
    /** The struck-through "was" price, in paisa. Optional, display only. */
    compareAtPrice: { min: 0, type: Number },
    /**
     * Gallery. The first entry is the card thumbnail; the detail screen pages
     * through the rest. Entries are either an uploaded asset or a hosted URL,
     * matching how Sponsor handles the same choice.
     */
    images: [
      {
        _id: false,
        assetId: { trim: true, type: String },
        url: { trim: true, type: String },
      },
    ],
    /** Free-text search terms beyond the name — "mattress", "gaddi", "bed". */
    tags: [{ trim: true, type: String }],
    trackStock: { default: true, type: Boolean },
    stockQuantity: { default: 0, min: 0, type: Number },
    /** Floor and ceiling on a single cart line. `maxOrderQuantity` 0 means no cap. */
    minOrderQuantity: { default: 1, min: 1, type: Number },
    maxOrderQuantity: { default: 0, min: 0, type: Number },
    /**
     * Surfaces the product in the shop's "Featured" strip. A flag rather than a
     * separate collection because featuring is a state of the product, and a
     * join table would let a featured row outlive the thing it points at.
     */
    isFeatured: { default: false, type: Boolean },
    priority: { default: 0, type: Number },
    isActive: { default: true, type: Boolean },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
    /** Seeded sample content — see CommunityPost. */
    isDemoData: { default: false, type: Boolean },
  },
  { timestamps: true },
);

storeProductSchema.index({ slug: 1 }, { unique: true });
// The shop list and the category filter, both of which sort the same way.
storeProductSchema.index({ isActive: 1, categoryId: 1, priority: -1, createdAt: -1 });
storeProductSchema.index({ isActive: 1, isFeatured: 1, priority: -1 });
// The search box. Weighted so a name match outranks a hit in the body copy.
storeProductSchema.index(
  { name: "text", summary: "text", tags: "text", description: "text" },
  { name: "store_product_search", weights: { description: 1, name: 10, summary: 4, tags: 6 } },
);

export const StoreProductModel =
  models.StoreProduct || model("StoreProduct", storeProductSchema);
