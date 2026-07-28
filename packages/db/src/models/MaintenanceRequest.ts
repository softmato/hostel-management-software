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
