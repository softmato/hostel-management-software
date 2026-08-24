import { Schema, model, models } from "mongoose";

/**
 * A department in the platform's supply store — "Bedding", "Cleaning",
 * "Kitchen", "Furniture".
 *
 * Created by the platform owner only. A hostel never writes one: this is one
 * catalogue that every hostel shops from, not a per-hostel shop, so the
 * collection carries no `hostelId` at all. That absence is the tenancy rule —
 * there is nothing here to scope, and a `hostelId` field would invite a filter
 * that quietly splits the catalogue in two.
 *
 * `slug` is the stable handle the mobile app filters by, so renaming a category
 * for display never breaks a saved link or an in-flight screen.
 */
const storeCategorySchema = new Schema(
  {
    name: { maxlength: 80, required: true, trim: true, type: String },
    slug: { lowercase: true, maxlength: 80, required: true, trim: true, type: String },
    /**
     * An Ionicons glyph name, resolved on the phone. A name rather than an
     * image because the reference grids are line-art tiles, and a category with
     * no artwork yet still has to draw as something other than a grey box.
     */
    icon: { default: "cube-outline", maxlength: 60, trim: true, type: String },
    /** Optional photograph for the tile. `imageAssetId` goes through the uploader. */
    imageAssetId: { trim: true, type: String },
    imageUrl: { trim: true, type: String },
    /** Higher wins, newest first inside a tie — same rule as Sponsor. */
    priority: { default: 0, type: Number },
    isActive: { default: true, type: Boolean },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

storeCategorySchema.index({ slug: 1 }, { unique: true });
// The shop's tile grid: live categories, best priority first.
storeCategorySchema.index({ isActive: 1, priority: -1, name: 1 });

export const StoreCategoryModel =
  models.StoreCategory || model("StoreCategory", storeCategorySchema);
