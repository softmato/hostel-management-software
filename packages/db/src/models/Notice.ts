import { Schema, model, models } from "mongoose";

const noticeSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    title: { required: true, trim: true, type: String },
    content: { required: true, trim: true, type: String },
    category: {
      default: "GENERAL",
      enum: ["GENERAL", "URGENT", "EVENT", "RULE", "MAINTENANCE", "PAYMENT", "FOOD"],
      type: String,
    },
    isUrgent: { default: false, type: Boolean },
    /**
     * Who the notice is addressed to (PHASES.md §3.1). Drives both the resident
     * fan-out and what a guardian dashboard is allowed to surface.
     */
    targetAudience: {
      default: "ALL",
      enum: ["ALL", "RESIDENTS", "GUARDIANS"],
      type: String,
    },
    publishedAt: { default: Date.now, type: Date },
    expiresAt: Date,
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

noticeSchema.index({ hostelId: 1, category: 1, publishedAt: -1 });
noticeSchema.index({ hostelId: 1, expiresAt: 1 });

export const NoticeModel = models.Notice || model("Notice", noticeSchema);
