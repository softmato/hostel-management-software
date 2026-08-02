import { Schema, model, models } from "mongoose";

const notificationSchema = new Schema(
  {
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    hostelId: { ref: "Hostel", type: Schema.Types.ObjectId },
    title: { type: String, required: true },
    body: { type: String, required: true },
    category: { type: String, required: true },
    channel: {
      type: String,
      enum: ["IN_APP", "PUSH", "EMAIL", "SMS"],
      default: "IN_APP",
    },
    data: { default: {}, type: Schema.Types.Mixed },
    /** Set when an authored campaign produced this row; null for system alerts. */
    campaignId: { ref: "NotificationCampaign", type: Schema.Types.ObjectId },
    priority: {
      default: "NORMAL",
      enum: ["LOW", "NORMAL", "HIGH", "URGENT"],
      type: String,
    },
    /**
     * `deliveredAt` is when the row reached the recipient's feed (in-app: the
     * moment it is written). `readAt` is when they opened it. Delivery stats
     * count these two against the campaign's recipient total.
     */
    deliveredAt: Date,
    readAt: Date,
    status: { type: String, enum: ["QUEUED", "SENT", "FAILED"], default: "QUEUED" },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ hostelId: 1, status: 1 });
// Delivery stats read every receipt for one campaign.
notificationSchema.index({ campaignId: 1, readAt: 1 });

export const NotificationModel =
  models.Notification || model("Notification", notificationSchema);
