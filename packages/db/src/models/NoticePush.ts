import { Schema, model, models } from "mongoose";

/**
 * A hostel's push notice: a notice that goes out on its own — now, later, every
 * day, or on chosen weekdays — to the residents' phones and the notice board.
 *
 * Same shape of timing as `PlatformPushSchedule`: Nepal wall-clock `startsOn`
 * and `time`, one UTC `nextRunAt` for the cron, and advancing `nextRunAt` is the
 * claim — see `dispatchDueNoticePushes`.
 *
 * `seedKey` marks a push the platform created for the hostel (the clothes
 * washing reminder). Deleting one only flips it to DELETED, so the seed never
 * comes back after an admin removed it.
 */
const noticePushSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    title: { required: true, trim: true, type: String },
    body: { required: true, trim: true, type: String },
    isUrgent: { default: false, type: Boolean },
    /** NOW sends on save; LATER is one send at `startsOn` + `time`. */
    repeat: { enum: ["NOW", "LATER", "DAILY", "WEEKLY"], required: true, type: String },
    startsOn: { type: String },
    time: { type: String },
    /** Nepal weekdays, 0 = Sunday. WEEKLY only. */
    weekdays: { default: [], type: [Number] },
    nextRunAt: { default: null, type: Date },
    status: {
      default: "ACTIVE",
      enum: ["ACTIVE", "PAUSED", "DONE", "DELETED"],
      type: String,
    },
    lastRunAt: Date,
    lastNoticeId: { ref: "Notice", type: Schema.Types.ObjectId },
    runCount: { default: 0, type: Number },
    seedKey: { type: String },
    createdBy: { ref: "User", required: true, type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

noticePushSchema.index({ status: 1, nextRunAt: 1 });
noticePushSchema.index({ hostelId: 1, status: 1 });
noticePushSchema.index(
  { hostelId: 1, seedKey: 1 },
  { partialFilterExpression: { seedKey: { $type: "string" } }, unique: true },
);

export const NoticePushModel = models.NoticePush || model("NoticePush", noticePushSchema);
