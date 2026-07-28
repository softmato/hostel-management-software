export const DEFAULT_IMAGE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const DEFAULT_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
];

/**
 * Every MIME type the platform accepts anywhere, deduped. This is the list the
 * browser-side universal uploader pre-validates against; the server remains
 * authoritative via {@link validateFileAssetMetadata}, which additionally honours
 * the `ALLOWED_*_MIME_TYPES` env overrides that a client cannot see.
 */
export const PLATFORM_ACCEPTED_MIME_TYPES = Array.from(
  new Set([...DEFAULT_IMAGE_MIME_TYPES, ...DEFAULT_DOCUMENT_MIME_TYPES]),
);

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function mimeList(value: string | undefined, fallback: string[]) {
  const parsed =
    value
      ?.split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean) ?? [];

  return parsed.length > 0 ? parsed : fallback;
}

export function fileAssetLimits() {
  return {
    allowedDocumentMimeTypes: mimeList(
      process.env.ALLOWED_DOCUMENT_MIME_TYPES,
      DEFAULT_DOCUMENT_MIME_TYPES,
    ),
    allowedImageMimeTypes: mimeList(
      process.env.ALLOWED_IMAGE_MIME_TYPES,
      DEFAULT_IMAGE_MIME_TYPES,
    ),
    maxDocumentBytes: positiveInteger(
      process.env.UPLOAD_MAX_DOCUMENT_BYTES,
      DEFAULT_DOCUMENT_BYTES,
    ),
    maxImageBytes: positiveInteger(
      process.env.UPLOAD_MAX_IMAGE_BYTES,
      DEFAULT_IMAGE_BYTES,
    ),
  };
}

export function validateFileAssetMetadata(input: {
  mimeType?: string | null;
  sizeBytes?: number | null;
}) {
  const limits = fileAssetLimits();
  const mimeType = input.mimeType?.toLowerCase().trim();
  const sizeBytes = input.sizeBytes;

  if (!mimeType) {
    return "File MIME type is required.";
  }

  if (!Number.isFinite(sizeBytes) || typeof sizeBytes !== "number" || sizeBytes <= 0) {
    return "File size must be a positive number of bytes.";
  }

  if (limits.allowedImageMimeTypes.includes(mimeType)) {
    return sizeBytes <= limits.maxImageBytes
      ? null
      : `Image exceeds the ${limits.maxImageBytes} byte upload limit.`;
  }

  if (limits.allowedDocumentMimeTypes.includes(mimeType)) {
    return sizeBytes <= limits.maxDocumentBytes
      ? null
      : `Document exceeds the ${limits.maxDocumentBytes} byte upload limit.`;
  }

  return "File MIME type is not allowed.";
}
