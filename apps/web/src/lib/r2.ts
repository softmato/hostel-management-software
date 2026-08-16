import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Storage lives in **two** buckets, split by whether the object is world-readable.
 *
 * The single-bucket arrangement this replaces had a hole that the 15-minute
 * presigned TTL hid rather than closed. A presigned URL carries the object key
 * in its path, so anyone who was ever shown one could strip the `X-Amz-*` query
 * string and re-request the same key unsigned — and because the one bucket had
 * public access enabled so that gallery photos could be served, that unsigned
 * request succeeded. Forever. Payment proofs and citizenship scans sat in that
 * bucket alongside the photos.
 *
 * Splitting them means the private bucket has no public base URL at all, so
 * there is no unsigned form of the request to fall back to. The TTL becomes the
 * real limit rather than a decorative one.
 *
 * Objects are additionally namespaced under `R2_KEY_PREFIX`, because these
 * buckets are shared with the rest of the company's projects.
 */

export type AccessLevel = "PRIVATE" | "PROTECTED" | "PUBLIC";

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

/** Test seam — the client caches credentials, so a test that changes them must reset. */
export function resetR2Client() {
  client = null;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} must be set. See docs/ENVIRONMENT.md.`);
  }

  return value;
}

/** Bucket with public access enabled. Gallery photos and other public assets only. */
export function publicBucket(): string {
  return requireEnv("R2_BUCKET_PUBLIC");
}

/**
 * Bucket with **no** public base URL. Everything reachable only through a
 * presigned read: payment proofs, identity documents, statements, receipts.
 */
export function privateBucket(): string {
  return requireEnv("R2_BUCKET_PRIVATE");
}

/**
 * `PROTECTED` deliberately lands in the private bucket alongside `PRIVATE`.
 *
 * Protected means "authenticated and authorised", not "world-readable", and the
 * authorisation is enforced in the read route. Putting it in a bucket with a
 * public base URL would make that check bypassable by anyone holding the key.
 */
export function bucketForAccessLevel(accessLevel: AccessLevel): string {
  return accessLevel === "PUBLIC" ? publicBucket() : privateBucket();
}

/**
 * The folder this project owns inside each shared bucket, without slashes.
 *
 * Empty when unset, so a deployment with a bucket to itself keeps writing bare
 * keys rather than being forced into a folder it does not need.
 */
export function keyPrefix(): string {
  return (process.env.R2_KEY_PREFIX ?? "").replace(/^\/+|\/+$/g, "");
}

/** Prepends the project prefix to a key that does not already carry it. */
export function withKeyPrefix(key: string): string {
  const prefix = keyPrefix();
  const bare = key.replace(/^\/+/, "");

  if (!prefix || bare === prefix || bare.startsWith(`${prefix}/`)) {
    return bare;
  }

  return `${prefix}/${bare}`;
}

export function generateFileKey(prefix: string, fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "bin";
  const uniqueId = crypto.randomUUID();
  return withKeyPrefix(`${prefix}/${uniqueId}.${ext}`);
}

export async function getPresignedUploadUrl(
  bucket: string,
  key: string,
  contentType: string,
  maxSizeBytes?: number,
) {
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

export async function getPresignedReadUrl(bucket: string, key: string) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  return getSignedUrl(getR2Client(), command, {
    expiresIn: PRIVATE_READ_URL_TTL_SECONDS,
  });
}

/**
 * Public (unsigned) URL for an object in the public bucket, which is served by
 * an R2.dev subdomain or custom domain. Use ONLY for assets that are
 * intentionally public (e.g. hostel gallery photos) — never for private
 * documents or payment proofs, which must go through {@link getPresignedReadUrl}.
 *
 * `R2_PUBLIC_URL` must point at {@link publicBucket} and nothing else. Pointing
 * it at the private bucket would reintroduce exactly the hole the split closed.
 */
export function getPublicUrl(key: string) {
  const publicBase = process.env.R2_PUBLIC_URL;

  if (!publicBase) {
    throw new Error("R2_PUBLIC_URL must be set to build public object URLs");
  }

  return `${publicBase.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

/**
 * Permanently deletes an object. Best-effort: R2 returns success even if the key
 * does not exist, so callers can treat this as idempotent.
 */
export async function deleteFromR2(bucket: string, key: string) {
  await getR2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
