/**
 * The one upload path: presign → PUT to R2 → complete.
 *
 * Ports the web's universal uploader. Three steps, and none of them is
 * optional:
 *
 * 1. `POST /files/presign` creates a `FileAsset` row **before any bytes exist**
 *    and returns a presigned URL. The row is a reservation carrying only the
 *    client's own description of the file.
 * 2. The PUT goes **straight to R2**, not through our API. It therefore carries
 *    no bearer token — the signature in the URL is the authorisation, and
 *    adding an `Authorization` header makes S3-compatible storage reject the
 *    request outright.
 * 3. `POST /files/{assetId}/complete` reads the stored object back, rejects it
 *    if it contradicts the description, and stamps `uploadCompletedAt`. **An
 *    asset that never completes is not usable as evidence** — a claim
 *    referencing one is refused — so skipping step 3 produces an upload that
 *    looks fine on the phone and is invisible to the hostel.
 *
 * `kind: "PAYMENT_PROOF"` is not decoration: the presign route refuses a
 * financial asset that is not tenant-scoped, because money evidence that is not
 * hostel-scoped cannot be authorised on read. A resident's principal carries
 * exactly one hostel, so the server resolves it without the client sending one.
 */

import { File, UploadType } from "expo-file-system";
import type { ImagePickerAsset } from "expo-image-picker";

import { API_BASE_URL, api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";
import { resolveFileName, resolveMimeType } from "@/lib/mime";

export type FileAssetKind = "GENERIC" | "PAYMENT_PROOF" | "PAYMENT_QR" | "STATEMENT";

export type UploadProgress = {
  /** 0–1, or null while the size is unknown. */
  fraction: number | null;
  stage: "presigning" | "uploading" | "verifying";
};

export class UploadError extends Error {
  constructor(
    message: string,
    readonly stage: UploadProgress["stage"],
  ) {
    super(message);
    this.name = "UploadError";
  }
}

type PresignResponse = { assetId: string; key: string; presignedUrl: string };

/**
 * Uploads one picked file and returns the asset id to attach to a claim.
 *
 * `onProgress` is called at each stage so a caller can drive the global
 * progress toaster; the PUT itself reports byte progress where the platform
 * supports it.
 */
export async function uploadAsset(
  asset: Pick<ImagePickerAsset, "fileName" | "fileSize" | "mimeType" | "uri">,
  {
    kind = "GENERIC",
    onProgress,
  }: { kind?: FileAssetKind; onProgress?: (progress: UploadProgress) => void } = {},
): Promise<string> {
  const mimeType = resolveMimeType(asset);
  const fileName = resolveFileName(asset);

  /*
   * SDK 54 replaced `getInfoAsync`/`createUploadTask` with the `File` object;
   * the old functions still exist under `expo-file-system/legacy`, and reaching
   * for them is how a codebase ends up with two file APIs.
   */
  const file = new File(asset.uri);
  const sizeBytes = asset.fileSize || file.size;

  if (!file.exists || !sizeBytes) {
    throw new UploadError("That file could not be read, or it is empty.", "presigning");
  }

  onProgress?.({ fraction: 0, stage: "presigning" });

  const presigned = unwrap(
    await api.post<ApiEnvelope<PresignResponse>>("/files/presign", {
      accessLevel: "PRIVATE",
      fileName,
      kind,
      mimeType,
      sizeBytes,
    }),
  );

  onProgress?.({ fraction: 0, stage: "uploading" });

  /*
   * Straight to R2 with `expo-file-system`'s uploader rather than reading the
   * file into JS and handing it to axios. A rent receipt photographed on a
   * modern phone is several megabytes, and base64 in memory is that again by
   * a third — enough to kill a low-end Android device mid-payment.
   *
   * No `Authorization` header: the URL's signature is the credential, and an
   * extra auth header makes S3-compatible storage reject the request.
   */
  const result = await file.upload(presigned.presignedUrl, {
    headers: { "Content-Type": mimeType },
    httpMethod: "PUT",
    mimeType,
    onProgress: ({ bytesSent, totalBytes }) => {
      onProgress?.({
        fraction: totalBytes > 0 ? bytesSent / totalBytes : null,
        stage: "uploading",
      });
    },
    uploadType: UploadType.BINARY_CONTENT,
  });

  if (!result || result.status < 200 || result.status >= 300) {
    throw new UploadError(
      "The upload did not reach our storage. Check your connection and try again.",
      "uploading",
    );
  }

  onProgress?.({ fraction: 1, stage: "verifying" });

  /*
   * Not optional. Until this runs the asset is a reservation, and the finance
   * module refuses a claim whose evidence never completed — which on the phone
   * looks like a successful upload and a rejected submit with no obvious link
   * between the two.
   */
  unwrap(
    await api.post<ApiEnvelope<{ assetId: string }>>(
      `/files/${presigned.assetId}/complete`,
    ),
  );

  return presigned.assetId;
}

/** The authorising read route for a private asset. Needs the bearer token. */
export function assetUrl(assetId: string) {
  return `${API_BASE_URL}/api/v1/files/${assetId}/url`;
}
