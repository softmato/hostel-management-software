import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

import { getR2Client } from "@/lib/r2";
import { validateFileAssetMetadata } from "@/lib/file-assets";

/**
 * Post-upload verification (target §13.3, plan item 0.3).
 *
 * `mimeType` and `sizeBytes` on a presigned upload are whatever the client said
 * before any bytes existed. A client can declare `image/png`, 1 KB, and then PUT
 * anything the presign permits — so the stored object is read back and the
 * declaration is checked against it. What storage reports is the truth; the
 * declaration is only a claim, and a claim that disagrees invalidates the asset
 * rather than being quietly corrected.
 */

export class UploadVerificationError extends Error {
  constructor(
    message: string,
    public errorCode = "UPLOAD_VERIFICATION_FAILED",
    public status = 422,
  ) {
    super(message);
    this.name = "UploadVerificationError";
  }
}

export type VerifiedUpload = {
  /**
   * The stored bytes. Returned rather than kept private because the caller may
   * need to derive more than one fingerprint from them (item 3.4's perceptual
   * hash), and reading the object a second time to do so would double the
   * storage round-trips for every upload.
   */
  bytes: Buffer;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
};

/** SHA-256 of the bytes as stored. Also the evidence hash of target §8.1. */
export function hashBytes(bytes: Buffer | Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeMime(value?: string) {
  return (value ?? "").split(";")[0]!.trim().toLowerCase();
}

/**
 * Confirms an object exists, re-reads its real content type and size, and
 * returns them alongside the content hash. Throws when the object is missing or
 * when it contradicts what was declared at presign time.
 */
export async function verifyUploadedObject(input: {
  bucket: string;
  declaredMimeType: string;
  declaredSizeBytes: number;
  key: string;
}): Promise<VerifiedUpload> {
  const client = getR2Client();

  let head;

  try {
    head = await client.send(
      new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
    );
  } catch {
    throw new UploadVerificationError(
      "The uploaded file could not be found in storage. Please try again.",
      "UPLOAD_NOT_FOUND",
      422,
    );
  }

  const mimeType = normalizeMime(head.ContentType);
  const sizeBytes = head.ContentLength ?? 0;

  if (mimeType !== normalizeMime(input.declaredMimeType)) {
    throw new UploadVerificationError(
      "The uploaded file is not the type it was declared as.",
      "UPLOAD_TYPE_MISMATCH",
      422,
    );
  }

  if (sizeBytes !== input.declaredSizeBytes) {
    throw new UploadVerificationError(
      "The uploaded file is not the size it was declared as.",
      "UPLOAD_SIZE_MISMATCH",
      422,
    );
  }

  // Re-run the platform's own type and size policy against the *stored* values,
  // not the declared ones, so an env limit tightened after presign still holds.
  const violation = validateFileAssetMetadata({ mimeType, sizeBytes });

  if (violation) {
    throw new UploadVerificationError(violation, "FILE_TYPE_NOT_ALLOWED", 422);
  }

  const object = await client.send(
    new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
  );
  const bytes = await object.Body?.transformToByteArray();

  if (!bytes) {
    throw new UploadVerificationError(
      "The uploaded file could not be read back from storage. Please try again.",
      "UPLOAD_UNREADABLE",
      422,
    );
  }

  const buffer = Buffer.from(bytes);

  return { bytes: buffer, contentHash: hashBytes(buffer), mimeType, sizeBytes };
}
