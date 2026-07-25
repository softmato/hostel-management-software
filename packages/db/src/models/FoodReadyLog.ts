import { Schema, model, models } from "mongoose";

/**
 * One record per "Food Ready" announcement from the cook portal. Keeps the
 * timing history that the food-transparency reports are built from.
 */
const foodReadyLogSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    mealType: {
      enum: ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"],
      required: true,
      type: String,
    },
    announcedAt: { default: Date.now, type: Date },
    announcedBy: { ref: "User", required: true, type: Schema.Types.ObjectId },
    message: { trim: true, type: String },
    menuId: { ref: "FoodMenu", type: Schema.Types.ObjectId },
    /** Identifies which cook announced when several share one login. */
    deviceInfo: { default: {}, type: Schema.Types.Mixed },
    notifiedCount: { default: 0, min: 0, type: Number },
  },
  { timestamps: true },
);

foodReadyLogSchema.index({ hostelId: 1, announcedAt: -1 });
foodReadyLogSchema.index({ hostelId: 1, mealType: 1, announcedAt: -1 });

export const FoodReadyLogModel =
  models.FoodReadyLog || model("FoodReadyLog", foodReadyLogSchema);
