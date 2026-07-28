import {
  DEFAULT_DOCUMENT_BYTES,
  DEFAULT_DOCUMENT_MIME_TYPES,
  DEFAULT_IMAGE_BYTES,
  DEFAULT_IMAGE_MIME_TYPES,
  PLATFORM_ACCEPTED_MIME_TYPES,
} from "@hostel/shared/utils/file-assets";

/**
 * Browser-side mirror of the server's file rules.
 *
 * The server is always the authority (`validateFileAssetMetadata` on every
 * upload route) — this exists so the uploader can reject an obviously bad file
 * before spending the user's bandwidth, and so `<input accept>` advertises the
 * right types in the OS file picker. Env overrides (`ALLOWED_*_MIME_TYPES`,
 * `UPLOAD_MAX_*_BYTES`) are server-only, so a file that passes here can still be
 * rejected server-side; that path surfaces as a normal upload error.
 */
export type UploadKind = "any" | "document" | "image";

type KindRule = {
  /** Human label used in error copy, e.g. "Image must be JPG, PNG or WebP." */
  label: string;
  maxBytes: number;
  mimeTypes: string[];
};

const KIND_RULES: Record<UploadKind, KindRule> = {
  any: {
    label: "File",
    // The widest limit any accepted type allows; per-type limits still apply below.
    maxBytes: Math.max(DEFAULT_DOCUMENT_BYTES, DEFAULT_IMAGE_BYTES),
    mimeTypes: PLATFORM_ACCEPTED_MIME_TYPES,
  },
  document: {
    label: "Document",
    maxBytes: DEFAULT_DOCUMENT_BYTES,
    mimeTypes: DEFAULT_DOCUMENT_MIME_TYPES,
  },
  image: {
    label: "Image",
    maxBytes: DEFAULT_IMAGE_BYTES,
    mimeTypes: DEFAULT_IMAGE_MIME_TYPES,
  },
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "text/plain": "TXT",
};

export function uploadKindRule(kind: UploadKind = "any") {
  return KIND_RULES[kind];
}

/** Value for an `<input type="file" accept="...">` attribute. */
export function acceptAttribute(kind: UploadKind = "any", override?: string) {
  return override ?? uploadKindRule(kind).mimeTypes.join(",");
}

function joinTypes(labels: string[]) {
  if (labels.length <= 1) {
    return labels[0] ?? "Any file";
  }

  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

function labelsFor(mimeTypes: string[]) {
  return mimeTypes
    .map((mime) => EXTENSION_BY_MIME[mime.trim().toLowerCase()])
    .filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
}

/**
 * "JPG, PNG or WebP up to 5 MB" — the hint shown under a drop zone.
 *
 * Images and documents have different server caps, so a field that accepts both
 * spells out each rather than quoting one limit that is wrong for half the list.
 */
export function uploadHint(kind: UploadKind = "any", override?: string) {
  const rule = uploadKindRule(kind);
  const mimeTypes = (override ? override.split(",") : rule.mimeTypes).map((mime) =>
    mime.trim().toLowerCase(),
  );

  const imageMax = Math.min(rule.maxBytes, DEFAULT_IMAGE_BYTES);
  const images = labelsFor(mimeTypes.filter((mime) => DEFAULT_IMAGE_MIME_TYPES.includes(mime)));
  const others = labelsFor(mimeTypes.filter((mime) => !DEFAULT_IMAGE_MIME_TYPES.includes(mime)));

  if (images.length > 0 && others.length > 0 && imageMax !== rule.maxBytes) {
    return `${joinTypes(images)} up to ${formatBytes(imageMax)} · ${joinTypes(
      others,
    )} up to ${formatBytes(rule.maxBytes)}`;
  }

  const allLabels = labelsFor(mimeTypes);
  const max = others.length === 0 ? imageMax : rule.maxBytes;

  return `${joinTypes(allLabels)} up to ${formatBytes(max)}`;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  // One decimal for small values, but never a bare ".0" — "5 MB", not "5.0 MB".
  const rounded =
    value >= 10 || exponent === 0 ? Math.round(value) : Number(value.toFixed(1));

  return `${rounded} ${units[exponent]}`;
}

/**
 * Returns an error message when the file is not acceptable, `null` when it is.
 * `accept` mirrors the `<input accept>` value so a call site that narrows the
 * picker (e.g. images only) gets the same narrowing enforced here.
 */
export function validateFileForUpload(
  file: File,
  options: { accept?: string; kind?: UploadKind } = {},
) {
  const rule = uploadKindRule(options.kind ?? "any");
  const mimeType = file.type.toLowerCase().trim();
  const allowed = options.accept
    ? options.accept.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)
    : rule.mimeTypes;

  if (!mimeType) {
    return `${file.name} has an unrecognised file type.`;
  }

  if (!allowed.includes(mimeType)) {
    return `${file.name} is not an accepted file type. Allowed: ${uploadHint(
      options.kind ?? "any",
      options.accept,
    )}.`;
  }

  // Images carry the tighter of the two server limits even inside an "any" picker.
  const maxBytes = DEFAULT_IMAGE_MIME_TYPES.includes(mimeType)
    ? Math.min(rule.maxBytes, DEFAULT_IMAGE_BYTES)
    : rule.maxBytes;

  if (file.size <= 0) {
    return `${file.name} is empty.`;
  }

  if (file.size > maxBytes) {
    return `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(maxBytes)}.`;
  }

  return null;
}
