import { Schema, model, models } from "mongoose";

/**
 * A superadmin push that goes out later, once or on a repeat.
 *
 * Dates and times are Nepal wall-clock (`YYYY-MM-DD`, `HH:mm`) because that is
 * what the superadmin typed and what a repeat is anchored to; `nextRunAt` is
 * the one UTC instant the cron reads. Advancing `nextRunAt` is also the claim —
 * see `dispatchDuePlatformPushes`.
 */
const platformPushScheduleSchema = new Schema(
  {
    title: { required: true, trim: true, type: String },
    body: { required: true, trim: true, type: String },
    urgency: { default: "NORMAL", enum: ["NORMAL", "URGENT"], type: String },
    audience: {
      default: "EVERYONE",
      enum: ["EVERYONE", "HOSTEL_STAFF", "RESIDENTS", "GUARDIANS"],
      type: String,
    },
    repeat: { enum: ["ONCE", "DAILY", "WEEKLY"], required: true, type: String },
    /** First (or only) Nepal date the push may go out. */
    startsOn: { required: true, type: String },
    /** Nepal time of day, `HH:mm`. */
    time: { required: true, type: String },
    /** Nepal weekdays, 0 = Sunday. WEEKLY only. */
    weekdays: { default: [], type: [Number] },
    /** Last Nepal date a repeat may go out on; absent runs until cancelled. */
    endsOn: { type: String },
    nextRunAt: { default: null, type: Date },
    status: {
      default: "ACTIVE",
      enum: ["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"],
      type: String,
    },
    lastRunAt: Date,
    lastRecipients: { default: 0, type: Number },
    lastDevices: { default: 0, type: Number },
    runCount: { default: 0, type: Number },
    createdBy: { ref: "User", required: true, type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

platformPushScheduleSchema.index({ status: 1, nextRunAt: 1 });

export const PlatformPushScheduleModel =
  models.PlatformPushSchedule ||
  model("PlatformPushSchedule", platformPushScheduleSchema);
