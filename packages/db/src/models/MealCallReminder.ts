import { Schema, model, models } from "mongoose";

/**
 * One row per "the lunch button is live" push the kitchen has been sent.
 *
 * ## Why the reminder needs a record at all
 *
 * The cron that sends it runs on a fixed cadence and the moment a meal comes
 * due falls between two runs, so the job cannot ask "is it exactly now" — it
 * asks "did this meal come due since a little while ago", which a retried,
 * overlapping or double-scheduled invocation answers `yes` to more than once.
 * Without a claim, a slow run overlapping the next one calls every cook in the
 * country twice, and the second buzz is the one that gets the FOOD category
 * muted for good.
 *
 * So the row is written **first** and the push is sent only if the write won:
 * the unique index is the lock. A crash between the two loses one reminder,
 * which is the right way round — the cook's own screen still unlocks the button
 * on its own clock, and the announcement is theirs to make either way.
 *
 * ## Keyed by the hostel's day, not by a timestamp
 *
 * `day` is `YYYY-MM-DD` in Nepal, so "today's lunch reminder" means the same
 * thing to a server in UTC and to a handset in the kitchen. A `Date` would make
 * the uniqueness depend on the hour the job happened to run.
 *
 * Rows are disposable once the day is over; the TTL index clears them so this
 * never becomes a collection anybody has to think about again.
 */
const mealCallReminderSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    mealType: {
      enum: ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"],
      required: true,
      type: String,
    },
    /** `YYYY-MM-DD` in Asia/Kathmandu — the kitchen's day, not UTC's. */
    day: { required: true, type: String },
    /** How many cook accounts the push actually reached. Nothing reads it yet. */
    notifiedCount: { default: 0, min: 0, type: Number },
    sentAt: { default: Date.now, type: Date },
  },
  { timestamps: true },
);

/** The lock. A second run for the same meal on the same day cannot insert. */
mealCallReminderSchema.index({ hostelId: 1, mealType: 1, day: 1 }, { unique: true });

/**
 * Swept after a week. The row's only job is to be in the way for the rest of
 * the day it was written; keeping a few extra days makes a "was the kitchen
 * reminded?" support question answerable without keeping them forever.
 */
mealCallReminderSchema.index({ sentAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export const MealCallReminderModel =
  models.MealCallReminder || model("MealCallReminder", mealCallReminderSchema);
