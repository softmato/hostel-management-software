import { Schema, model, models } from "mongoose";

const DAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

const MEALS = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"] as const;

const routineMealSchema = new Schema(
  {
    dayOfWeek: { enum: DAYS, required: true, type: String },
    mealType: { enum: MEALS, required: true, type: String },
    items: [{ required: true, trim: true, type: String }],
    note: { trim: true, type: String },
  },
  { _id: false },
);

/**
 * A hostel's weekly food routine — one document, the whole week.
 *
 * The routine repeats: "Friday dinner" is a fact about Fridays, not about one
 * particular Friday. It used to be stored as dated `FoodMenu` rows, which meant
 * every week had to be re-entered, "this week" and "next week" could silently
 * disagree, and the month end treat — written as the dinner row for the last
 * day of the month — overwrote whatever that day's dinner was.
 *
 * So: meals are keyed by day of week, timings are per meal for the whole week,
 * and the optional month end treat sits alongside as its own field.
 */
const foodRoutineSchema = new Schema(
  {
    hostelId: {
      ref: "Hostel",
      required: true,
      type: Schema.Types.ObjectId,
      unique: true,
    },
    /** One timing per meal, shared by every day. */
    timings: {
      BREAKFAST: { trim: true, type: String },
      LUNCH: { trim: true, type: String },
      SNACKS: { trim: true, type: String },
      DINNER: { trim: true, type: String },
    },
    meals: { default: [], type: [routineMealSchema] },
    /** Optional extra served on the last day of the month. */
    monthEndSpecial: {
      items: [{ trim: true, type: String }],
      note: { trim: true, type: String },
    },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

export const FoodRoutineModel =
  models.FoodRoutine || model("FoodRoutine", foodRoutineSchema);
