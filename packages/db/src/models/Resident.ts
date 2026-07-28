import { Schema, model, models } from "mongoose";

const residentSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    userId: { ref: "User", type: Schema.Types.ObjectId },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    // Residents are tracked against a room type, not an individual room or
    // bed. Occupancy is a running count on hostel.roomConfigurations: taking a
    // resident in decrements that type's vacantBeds, moving them out adds it
    // back. There are no Room or Bed records to point at.
    roomType: { type: String, required: true, trim: true },
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

// Deletion is soft (`isDeleted`), so a plain unique index would keep a removed
// resident's phone reserved forever and make re-registering the same person
// fail with a raw E11000. The partial filter scopes uniqueness to the residents
// that are actually still on the roll.
residentSchema.index(
  { hostelId: 1, phone: 1 },
  { partialFilterExpression: { isDeleted: false }, unique: true },
);
residentSchema.index({ hostelId: 1, status: 1 });
residentSchema.index({ hostelId: 1, roomType: 1 });
residentSchema.index({ userId: 1, status: 1 });

export const ResidentModel = models.Resident || model("Resident", residentSchema);
