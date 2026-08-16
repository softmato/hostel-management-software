import { Schema, model, models } from "mongoose";

import { validateFileAssetMetadata } from "@hostel/shared/utils/file-assets";

const variantSchema = new Schema(
  {
    variant: {
      type: String,
      enum: ["ORIGINAL", "THUMBNAIL", "MEDIUM", "LARGE"],
      required: true,
    },
    key: { type: String, required: true },
    width: { type: Number },
    height: { type: Number },
    sizeBytes: { type: Number },
    mimeType: { type: String },
  },
  { _id: false },
);

const fileAssetSchema = new Schema(
  {
    hostelId: { ref: "Hostel", type: Schema.Types.ObjectId },
    ownerId: { ref: "User", type: Schema.Types.ObjectId },
    storageProvider: { type: String, required: true },
    bucket: { type: String, required: true },
    key: { type: String, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    accessLevel: {
      type: String,
      enum: ["PUBLIC", "PRIVATE", "PROTECTED"],
      default: "PRIVATE",
    },
    publicUrl: String,
    /**
     * Set once the bytes are confirmed to exist in storage and to match what
     * the client declared. Until then the row is a reservation, not a file:
     * a presign that is never followed by a PUT leaves one behind, and nothing
     * may use an unconfirmed asset as evidence (target §13.3).
     */
    uploadCompletedAt: Date,
    /** SHA-256 of the stored bytes, read back from storage — never client-sent. */
    contentHash: String,
    /**
     * 64-bit dHash of the image, as 16 hex characters (plan item 3.4).
     *
     * Answers "does this *look* like one we have seen?", where `contentHash`
     * answers "are these the same bytes?". A perceptual match is evidence, not
     * proof, and may only flag a claim for review — never auto-reject it.
     * Absent for anything that is not a decodable image.
     */
    perceptualHash: String,
    /**
     * Set when the uploaded bytes are a document *this system* generated — a
     * receipt or a statement (plan item 3.4 follow-on).
     *
     * Recorded at upload rather than enforced there: the file itself is
     * perfectly legitimate to store, and a resident may have good reason to
     * upload their own receipt somewhere. What it may never be is *evidence of
     * payment*, and that rule belongs to the finance module, which reads this.
     */
    systemDocumentKind: { type: String, enum: ["RECEIPT", "STATEMENT"] },
    /**
     * What the decoded image measures (gap fixes 2 and 3). Images only.
     *
     * Derived from the bytes at completion, because reading the object back a
     * second time when a claim is submitted would double the storage round-trips
     * on the one path a resident is actually waiting on.
     *
     * `nearBlank` is the load-bearing field, and it is *recorded* here rather
     * than enforced: a 4×4 white PNG is a perfectly legal image and a
     * meaningless proof of payment, so the rule belongs to the finance module —
     * same division as `systemDocumentKind` above.
     */
    imageInsight: {
      contrast: Number,
      height: Number,
      nearBlank: Boolean,
      width: Number,
    },
    variants: { type: [variantSchema], default: [] },
    status: { type: String, enum: ["ACTIVE", "DELETED"], default: "ACTIVE" },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
    deletedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

fileAssetSchema.pre("validate", function validateUploadPolicy() {
  const asset = this as {
    invalidate(path: string, message: string): void;
    mimeType?: string;
    sizeBytes?: number;
  };
  const violation = validateFileAssetMetadata({
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
  });

  if (violation) {
    asset.invalidate("mimeType", violation);
  }
});

fileAssetSchema.index({ hostelId: 1, status: 1 });
fileAssetSchema.index({ ownerId: 1, status: 1 });
fileAssetSchema.index({ key: 1 }, { unique: true });
// Drives the abandoned-presign sweep: rows with no completion, oldest first.
fileAssetSchema.index({ uploadCompletedAt: 1, createdAt: 1 });

export const FileAssetModel =
  models.FileAsset || model("FileAsset", fileAssetSchema);
