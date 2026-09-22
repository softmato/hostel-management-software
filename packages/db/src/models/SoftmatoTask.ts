import { Schema, model, models } from "mongoose";

/**
 * Something a person tried to do while Softmato — the parent company, which
 * issues every invoice and receipt — could not be reached.
 *
 * Nothing is printed in its place. The person is told the server is not
 * responding and that we will email them, and this row is that promise: the
 * every-minute cron retries it once Softmato answers, then emails them the
 * link to finish. One open row per thing, however many times they pressed.
 */
export const SOFTMATO_TASK_KINDS = ["PLAN_PAYMENT", "BOOKING_PAYMENT", "CASH_FILING", "REFUND_FILING"] as const;

const softmatoTaskSchema = new Schema(
  {
    kind: { enum: SOFTMATO_TASK_KINDS, required: true, type: String },
    /** The invoice, booking or payment id it is about. */
    ref: { required: true, trim: true, type: String },
    email: { default: null, trim: true, type: String },
    name: { default: null, trim: true, type: String },
    /** Where the emailed link sends them to finish. */
    link: { default: null, trim: true, type: String },
    attempts: { default: 0, type: Number },
    lastError: { default: null, type: String },
    doneAt: { default: null, type: Date },
  },
  { timestamps: true },
);

softmatoTaskSchema.index(
  { kind: 1, ref: 1 },
  { partialFilterExpression: { doneAt: null }, unique: true },
);
softmatoTaskSchema.index({ doneAt: 1, createdAt: 1 });

export const SoftmatoTaskModel = models.SoftmatoTask || model("SoftmatoTask", softmatoTaskSchema);
