import { Schema, model, models } from "mongoose";

const paymentProofSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", required: true, type: Schema.Types.ObjectId },
    paymentId: { ref: "Payment", required: true, type: Schema.Types.ObjectId },
    proofImageAssetId: { required: true, trim: true, type: String },
    /** Amount the resident claims to have paid with this proof. */
    amount: { min: 0, required: true, type: Number },
    paymentMethod: {
      enum: ["CASH", "ESEWA", "KHALTI", "FONEPAY", "BANK_TRANSFER", "OTHER"],
      type: String,
    },
    /** Free-text reference the resident adds (transaction id, bank memo…). */
    referenceNote: { trim: true, type: String },
    transactionCode: { trim: true, type: String },
    submittedAt: { default: Date.now, type: Date },
    submittedBy: { ref: "User", required: true, type: Schema.Types.ObjectId },
    reviewedBy: { ref: "User", type: Schema.Types.ObjectId },
    reviewedAt: Date,
    status: {
      default: "PENDING",
      enum: ["PENDING", "APPROVED", "REJECTED"],
      type: String,
    },
    rejectionReason: { type: String, trim: true },
  },
  { timestamps: true },
);

paymentProofSchema.index({ hostelId: 1, residentId: 1, status: 1 });
paymentProofSchema.index({ hostelId: 1, paymentId: 1, status: 1 });
paymentProofSchema.index({ paymentId: 1, submittedAt: -1 });

export const PaymentProofModel =
  models.PaymentProof || model("PaymentProof", paymentProofSchema);
