import { Schema, model, models } from "mongoose";

/**
 * A byte-for-byte copy of a PDF Softmato issued, so a download does not need
 * a round trip every time. A copy, never a redraw: the file is theirs.
 * `version` changes when the document can (an invoice turning paid).
 */
const softmatoDocumentSchema = new Schema(
  {
    kind: { enum: ["invoice", "receipt"], required: true, type: String },
    number: { required: true, trim: true, type: String },
    version: { default: "1", type: String },
    contentType: { required: true, type: String },
    bytes: { required: true, type: Buffer },
  },
  { timestamps: true },
);

softmatoDocumentSchema.index({ kind: 1, number: 1, version: 1 }, { unique: true });

export const SoftmatoDocumentModel =
  models.SoftmatoDocument || model("SoftmatoDocument", softmatoDocumentSchema);
