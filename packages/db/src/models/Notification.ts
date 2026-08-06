import { Schema, model, models } from "mongoose";

const notificationSchema = new Schema(
  {
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    hostelId: { ref: "Hostel", type: Schema.Types.ObjectId },
    title: { type: String, required: true },
    body: { type: String, required: true },
    category: { type: String, required: true },
    /**
     * What the recipient is expected to do with this row.
     *
     * `NORMAL` is a statement of fact — a notice went out, food is ready. It is
     * read and forgotten. `ACTION` means something is waiting on this person:
     * a hostel registration needs approving, a service provider application
     * needs reviewing, a payment proof needs confirming. Action rows carry a
     * destination (`actionUrl`) and optionally inline `actions`, and they stay
     * in the "Needs action" queue until `actionState` leaves `PENDING` — read
     * receipts alone do not clear them, because opening a request is not the
     * same as answering it.
     */
    kind: { type: String, enum: ["NORMAL", "ACTION"], default: "NORMAL" },
    /** Where the recipient goes to deal with this. Deep link within a portal. */
    actionUrl: String,
    /**
     * Buttons rendered inside the bell so the common decisions never need a
     * page load. `endpoint`/`method` are called as-is by the client.
     */
    actions: {
      default: undefined,
      type: [
        {
          _id: false,
          endpoint: { type: String, required: true },
          key: { type: String, required: true },
          label: { type: String, required: true },
          method: {
            default: "POST",
            enum: ["POST", "PATCH", "PUT", "DELETE"],
            type: String,
          },
          payload: { type: Schema.Types.Mixed },
          tone: {
            default: "default",
            enum: ["default", "primary", "danger"],
            type: String,
          },
        },
      ],
    },
    actionState: {
      default: "PENDING",
      enum: ["PENDING", "COMPLETED", "DISMISSED"],
      type: String,
    },
    actionTakenAt: Date,
    /** Which of `actions[].key` was chosen, for the resolved-state caption. */
    actionTakenKey: String,
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
// The "Needs action" tab reads one recipient's unresolved action rows.
notificationSchema.index({ userId: 1, kind: 1, actionState: 1, createdAt: -1 });

export const NotificationModel =
  models.Notification || model("Notification", notificationSchema);
