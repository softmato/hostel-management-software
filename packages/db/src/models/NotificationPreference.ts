import { Schema, model, models } from "mongoose";

/**
 * What a person wants to be interrupted by, and when.
 *
 * One row per user, created on first write — an account with no row gets the
 * defaults below, which is "everything, always". That is deliberate: the absence
 * of a preference must never read as "wants nothing", or a schema migration
 * would silently mute the whole product.
 *
 * ## Quiet hours are stored as minutes past local midnight
 *
 * Not as a `Date`, and not as a string. A `Date` would pin the preference to a
 * calendar day it has nothing to do with, and "22:30" as text needs parsing at
 * every read. An integer 0–1439 compares in one operation and survives every
 * timezone conversion unchanged.
 *
 * `quietHoursStart > quietHoursEnd` is the normal case, not an error: quiet
 * hours nearly always wrap midnight (22:00 → 07:00). The comparison that
 * handles it lives in `notification-quiet-hours.ts`.
 *
 * ## `timeZone` is per-account
 *
 * Nepal is the product's home and `Asia/Kathmandu` is the default, but the offset
 * is +05:45 — three quarters of an hour off every neighbouring zone — so getting
 * this wrong is not a rounding error, it is waking someone at 06:15. A resident
 * studying abroad sets their own.
 */
const notificationPreferenceSchema = new Schema(
  {
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId, unique: true },

    /**
     * The master switch for push. In-app notifications and the bell are
     * unaffected — those are pulled, not pushed, and turning off interruptions
     * is not the same as asking not to be told.
     */
    pushEnabled: { default: true, type: Boolean },

    quietHoursEnabled: { default: false, type: Boolean },
    /** Minutes past local midnight, 0–1439. Default 22:00. */
    quietHoursStart: { default: 22 * 60, max: 1439, min: 0, type: Number },
    /** Minutes past local midnight, 0–1439. Default 07:00. */
    quietHoursEnd: { default: 7 * 60, max: 1439, min: 0, type: Number },

    /** IANA zone. `Asia/Kathmandu` is +05:45 — see the note above. */
    timeZone: { default: "Asia/Kathmandu", trim: true, type: String },

    /**
     * Categories this account does not want pushed, by the same category string
     * `publishNewNotification` already carries.
     *
     * A deny-list rather than an allow-list, so a category added later reaches
     * everyone by default instead of nobody — the failure mode of an allow-list
     * is silence, and silence is the one failure nobody reports.
     */
    mutedCategories: { default: [], type: [String] },
  },
  { timestamps: true },
);

export const NotificationPreferenceModel =
  models.NotificationPreference ||
  model("NotificationPreference", notificationPreferenceSchema);
