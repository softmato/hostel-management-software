import { Schema, model, models } from "mongoose";

const residentSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    userId: { ref: "User", type: Schema.Types.ObjectId },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    roomId: { ref: "Room", required: true, type: Schema.Types.ObjectId },
    bedId: { ref: "Bed", required: true, type: Schema.Types.ObjectId },
    moveInDate: { type: Date, required: true },
    depositAmount: { min: 0, default: 0, type: Number },
    /** Recurring fee used when monthly payment records are generated. */
    monthlyFee: { min: 0, default: 0, type: Number },
    residentType: {
      type: String,
      enum: ["STUDENT", "WORKING_PROFESSIONAL", "OTHER"],
      default: "STUDENT",
    },
    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "SUSPENDED", "MOVED_OUT"],
      default: "PENDING",
    },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
    isDemoData: { type: Boolean, default: false },
    demoDataLabel: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
    deletedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

residentSchema.index({ hostelId: 1, phone: 1 }, { unique: true });
residentSchema.index({ hostelId: 1, status: 1 });
residentSchema.index({ hostelId: 1, roomId: 1 });
residentSchema.index({ hostelId: 1, bedId: 1 });
residentSchema.index({ userId: 1, status: 1 });

export const ResidentModel = models.Resident || model("Resident", residentSchema);
