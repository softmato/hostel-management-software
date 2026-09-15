import { uploadFile } from "./uploader";

/**
 * Uploads a registration document (citizenship, licence, PAN, house rules)
 * privately, through the private branch of `POST /public/files/upload`.
 *
 * Resolves with the FileAsset id and the claim token the application submits.
 * `lib/registration-documents.ts` on the server explains why both are needed.
 * Throws when the upload did not complete; by then the universal uploader has
 * already told the user why.
 */
export async function uploadRegistrationDocument(file: File, label: string) {
  const uploaded = await uploadFile(file, {
    kind: "document",
    label,
    silent: true,
    target: "public",
    visibility: "private",
  });

  if (!uploaded?.assetId || !uploaded.claimToken) {
    throw new Error("Upload failed");
  }

  return { claimToken: uploaded.claimToken, fileAssetId: uploaded.assetId };
}
