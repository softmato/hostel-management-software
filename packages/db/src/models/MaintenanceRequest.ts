import { Schema, model, models } from "mongoose";

const maintenanceRequestSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    providerId: { ref: "ServiceProvider", type: Schema.Types.ObjectId },
    // Free text ("Room 204", "2nd floor bathroom"). There are no Room or Bed
    // records to reference — the hostel tracks room types and counts only.
    location: { type: String, trim: true },
    category: {
      enum: [
        "PLUMBING",
        "ELECTRICAL",
        "INTERNET",
        "CLEANING",
        "CARPENTRY",
        "PAINTING",
        "WATER",
        "APPLIANCE",
        "ROOM_REPAIR",
        "HEALTH",
        "OTHER",
      ],
      required: true,
      type: String,
    },
    title: { required: true, trim: true, type: String },
    description: { trim: true, type: String },
    /**
     * A spoken description of the problem, recorded on the phone that raised
     * the request.
     *
     * Why it exists: the person who can see the leak is a warden standing in
     * front of it, and the person who has to understand it is a plumber reading
     * a sentence somebody typed one-handed. Thirty seconds of "it is the pipe
     * under the sink in 204, not the tap, and it only drips when the pump runs"
     * carries what a title never will.
     *
     * The asset is **PRIVATE** — it names rooms and is often recorded with
     * residents audible in the background — so it is read through
     * `files/{assetId}/url`, which grants the hostel, the platform, and the one
     * provider this request is assigned to. Nothing else.
     */
    voiceNoteAssetId: { ref: "FileAsset", type: Schema.Types.ObjectId },
    priority: {
      default: "MEDIUM",
      enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
      type: String,
    },
    status: {
      default: "PENDING",
      enum: ["PENDING", "CONTACTED", "SCHEDULED", "COMPLETED", "CANCELLED"],
      type: String,
    },
    scheduledFor: Date,
    completedAt: Date,
    costNote: { trim: true, type: String },
    remarks: { trim: true, type: String },
    requestedBy: { ref: "User", required: true, type: Schema.Types.ObjectId },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
    isDeleted: { default: false, type: Boolean },
    deletedAt: Date,
    deletedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

maintenanceRequestSchema.index({ hostelId: 1, status: 1, category: 1 });
maintenanceRequestSchema.index({ hostelId: 1, providerId: 1, createdAt: -1 });

export const MaintenanceRequestModel =
  models.MaintenanceRequest || model("MaintenanceRequest", maintenanceRequestSchema);
