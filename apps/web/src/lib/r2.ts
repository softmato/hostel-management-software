import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client: S3Client | null = null;

export function getR2Client() {
  if (!client) {
    const endpoint = process.env.R2_ENDPOINT;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must be set",
      );
    }

    client = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      // Resilience: retry transient R2/network failures with backoff.
      maxAttempts: 3,
      requestHandler: { requestTimeout: 30_000 },
    });
  }
  return client;
}

export function generateFileKey(prefix: string, fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "bin";
  const uniqueId = crypto.randomUUID();
  return `${prefix}/${uniqueId}.${ext}`;
}

export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  maxSizeBytes?: number,
) {
  const bucket = process.env.R2_BUCKET_NAME;

  if (!bucket) {
    throw new Error("R2_BUCKET_NAME must be set");
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ...(maxSizeBytes ? { ContentLength: maxSizeBytes } : {}),
  });
  return getSignedUrl(getR2Client(), command, { expiresIn: 600 });
}

/**
 * 15 minutes (PHASES.md §5.1). Long enough to open a payment proof or a
 * citizenship scan, short enough that a URL copied out of a browser's history
 * or an access log is dead by the time anyone else reaches it.
 */
export const PRIVATE_READ_URL_TTL_SECONDS = 900;

export async function getPresignedReadUrl(key: string) {
  const bucket = process.env.R2_BUCKET_NAME;

  if (!bucket) {
    throw new Error("R2_BUCKET_NAME must be set");
  }

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  return getSignedUrl(getR2Client(), command, {
    expiresIn: PRIVATE_READ_URL_TTL_SECONDS,
  });
}

/**
 * Public (unsigned) URL for an object in a bucket that has public access
 * enabled via an R2.dev subdomain or custom domain. Use ONLY for assets that
 * are intentionally public (e.g. hostel gallery photos) — never for private
 * documents or payment proofs, which must go through {@link getPresignedReadUrl}.
 *
 * Requires `R2_PUBLIC_URL` (e.g. https://pub-<id>.r2.dev).
 */
export function getPublicUrl(key: string) {
  const publicBase = process.env.R2_PUBLIC_URL;

  if (!publicBase) {
    throw new Error("R2_PUBLIC_URL must be set to build public object URLs");
  }

  return `${publicBase.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

/**
 * Permanently deletes an object from the bucket. Best-effort: R2 returns success
 * even if the key does not exist, so callers can treat this as idempotent.
 */
export async function deleteFromR2(key: string) {
  const bucket = process.env.R2_BUCKET_NAME;

  if (!bucket) {
    throw new Error("R2_BUCKET_NAME must be set");
  }

  await getR2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
