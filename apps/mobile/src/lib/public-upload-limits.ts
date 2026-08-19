/**
 * What `POST /public/files/upload` will actually accept.
 *
 * The two registration flows are the only callers, and they are the only two
 * uploads in the app that do **not** go through the presign pipeline in
 * `lib/uploads.ts`: an applicant registering a hostel has no `FileAsset` scope
 * and a tradesperson applying has no hostel, so the presign route — which
 * resolves a tenant off the principal — has nothing to scope the row to. The
 * public multipart route exists for exactly this and it is the same route the
 * website's registration forms use.
 *
 * Its limits are stricter than the presign route's and they are enforced in the
 * handler, not in a schema, so a violation comes back as a 422 with a sentence
 * in it. Checking here first is not belt-and-braces: the file has to be *sent*
 * before the server can refuse it, and refusing a 9 MB photo after uploading 9 MB
 * over a Nepali mobile connection is a minute of someone's life and their data
 * allowance. So the check that the server will apply is applied before the bytes
 * move.
 *
 * Pure and dependency-free so it is testable node-side — `lib/public-uploads.ts`
 * imports `expo-file-system` and Vitest here has no React Native shim (same
 * reason `lib/mime.ts` is split out of `lib/uploads.ts`).
 */

/** Mirrors `ALLOWED_TYPES` in the route handler. */
export const PUBLIC_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
] as const;

/** Mirrors `MAX_SIZE` in the route handler. */
export const PUBLIC_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Why this file cannot be sent, or `null` if it can.
 *
 * ## HEIC is the case that matters
 *
 * An iPhone photographs in HEIC and `resolveMimeType` will happily report
 * `image/heic` — a type this route rejects. The picker is asked for JPEG at both
 * call sites, but a file picked from Files rather than Photos can still arrive as
 * HEIC, and "File type not allowed. Accepted: JPEG, PNG, WebP, PDF, TXT" from a
 * server is a worse sentence than one that names the file's own format.
 */
export function publicUploadError(file: {
  mimeType: string;
  sizeBytes: number;
}): string | null {
  if (!(PUBLIC_UPLOAD_TYPES as readonly string[]).includes(file.mimeType)) {
    return `${file.mimeType} files can't be attached. Use a JPEG, PNG or PDF.`;
  }

  if (file.sizeBytes <= 0) {
    return "That file is empty, or it could not be read.";
  }

  if (file.sizeBytes > PUBLIC_UPLOAD_MAX_BYTES) {
    return `That file is ${formatMegabytes(file.sizeBytes)} — the limit is 5 MB. Photograph it again, or crop it.`;
  }

  return null;
}

/** `6.2 MB`. One decimal, because "6 MB" against a 5 MB limit reads as a bug. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
