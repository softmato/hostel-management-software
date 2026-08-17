/**
 * Deciding what a picked file *is*, before anything touches it.
 *
 * Its own module, with no imports, for the same reason `lib/status.ts` is:
 * Vitest here runs node-side with no React Native shim, so `lib/uploads.ts`
 * cannot be tested once it imports `expo-file-system`. This is the part of the
 * upload that has real branches, so it lives where the tests can reach it.
 *
 * The stakes: R2 signs the `Content-Type` into the presigned URL. If the type
 * declared at presign is not the type sent on the PUT, the upload fails with a
 * signature error that mentions nothing about content types — so both have to
 * come from one function, and that function must always return something.
 */

const EXTENSION_MIME: Record<string, string> = {
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  webp: "image/webp",
};

type PickedFile = {
  fileName?: string | null;
  mimeType?: string | null;
  uri: string;
};

/** `expo-image-picker` does not always populate `mimeType`; the uri always exists. */
export function resolveMimeType(asset: PickedFile): string {
  if (asset.mimeType) {
    return asset.mimeType;
  }

  const source = asset.fileName ?? asset.uri;
  // Android `content://` uris and cached picker paths routinely carry a query
  // string, which would otherwise be read as part of the extension.
  const extension = source.split("?")[0].split(".").pop()?.toLowerCase() ?? "";

  return EXTENSION_MIME[extension] ?? "image/jpeg";
}

/**
 * A name is required by the presign route and becomes part of the storage key,
 * so an unnamed pick gets a unique one rather than a hundred files called
 * "image".
 */
export function resolveFileName(asset: PickedFile): string {
  if (asset.fileName) {
    return asset.fileName;
  }

  const mime = resolveMimeType(asset);
  const extension =
    Object.entries(EXTENSION_MIME).find(([, value]) => value === mime)?.[0] ?? "jpg";

  return `upload-${Date.now()}.${extension}`;
}
