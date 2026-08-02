import { Schema, model, models } from "mongoose";

/**
 * One authored broadcast (PHASES.md §5.1 "Advanced Notifications").
 *
 * The per-recipient `Notification` rows are the receipts — a campaign is what
 * an admin wrote, who it was aimed at, and when it should go out. Keeping the
 * two apart means delivery stats are a count over receipts rather than a
 * separately-maintained tally that can drift.
 */
const notificationCampaignSchema = new Schema(
  {
    /** Null for a platform-wide campaign that spans hostels. */
    hostelId: { ref: "Hostel", type: Schema.Types.ObjectId },
    title: { required: true, trim: true, type: String },
    body: { required: true, trim: true, type: String },
    category: { default: "ANNOUNCEMENT", trim: true, type: String },
    priority: {
      default: "NORMAL",
      enum: ["LOW", "NORMAL", "HIGH", "URGENT"],
      type: String,
    },
    /**
     * ALL           — every resident in scope
     * RESIDENTS     — same as ALL today; kept distinct for when staff-only
     *                 audiences land
     * GUARDIANS     — linked guardians of residents in scope
     * SPECIFIC      — the residents listed in `residentIds`
     */
    audience: {
      default: "ALL",
      enum: ["ALL", "RESIDENTS", "GUARDIANS", "SPECIFIC"],
      type: String,
    },
    residentIds: [{ ref: "Resident", type: Schema.Types.ObjectId }],
    /** Platform-wide campaigns may target a subset of hostels. */
    hostelIds: [{ ref: "Hostel", type: Schema.Types.ObjectId }],
    scheduledFor: Date,
    sentAt: Date,
    status: {
      default: "SCHEDULED",
      enum: ["SCHEDULED", "SENT", "CANCELLED", "FAILED"],
      type: String,
    },
    /** Recipients written when the campaign was dispatched. */
    recipientCount: { default: 0, min: 0, type: Number },
    failureReason: { trim: true, type: String },
    scope: { default: "HOSTEL", enum: ["HOSTEL", "PLATFORM"], type: String },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

notificationCampaignSchema.index({ hostelId: 1, createdAt: -1 });
// The dispatch cron's only query: everything still waiting whose time has come.
notificationCampaignSchema.index({ status: 1, scheduledFor: 1 });
notificationCampaignSchema.index({ scope: 1, createdAt: -1 });

export const NotificationCampaignModel =
  models.NotificationCampaign ||
  model("NotificationCampaign", notificationCampaignSchema);
