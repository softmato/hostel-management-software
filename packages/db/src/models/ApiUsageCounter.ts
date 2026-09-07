import { Schema, model, models } from "mongoose";

/**
 * How many times we have called a metered third-party API this month.
 *
 * Exists for one reason: a bug that retries in a loop should cost a dashboard
 * warning, not a bill. The evidence recogniser calls Google Cloud Vision once
 * per uploaded receipt, which at one hostel sits inside the free tier and stays
 * there — but "sits inside the free tier" is a property of the *intended* call
 * rate, and nothing about a runaway retry is intended.
 *
 * **A counter, not a quota system.** There is no reservation, no rollback and no
 * per-caller accounting: a single atomic `$inc` returning the new value, which
 * the caller compares against a configured cap. Over-counting by one on a call
 * that then fails is the correct trade — the alternative is a two-phase commit
 * around an HTTP request to stay accurate about a number whose only job is to
 * stop a loop.
 *
 * Mongo rather than Redis, which is what a counter like this usually wants,
 * because this platform has no Redis and adding one to hold a single integer per
 * month would be a piece of infrastructure to operate for no gain.
 *
 * The period key is a plain UTC `YYYY-MM`, deliberately **not** the Bikram
 * Sambat month the rest of finance runs on: this counts against a vendor's
 * billing cycle, and that vendor bills in Gregorian months.
 */
const apiUsageCounterSchema = new Schema(
  {
    /** How many calls have been made in this period. */
    count: { default: 0, min: 0, type: Number },
    /** UTC `YYYY-MM`, matching the vendor's billing month. */
    period: { required: true, trim: true, type: String },
    /** Which metered API. `VISION_OCR` is the only one so far. */
    service: { required: true, trim: true, type: String },
  },
  { timestamps: true },
);

apiUsageCounterSchema.index({ service: 1, period: 1 }, { unique: true });

export const ApiUsageCounterModel =
  models.ApiUsageCounter || model("ApiUsageCounter", apiUsageCounterSchema);
