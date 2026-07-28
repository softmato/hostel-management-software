import { browserApi } from "@/lib/browser-api";

/**
 * Post-upload asset helpers.
 *
 * Uploading itself lives in `@/lib/uploads/uploader` (the universal uploader) —
 * this module only covers what you do with an asset *after* it exists.
 */

type OptimizeResponse = {
  assetId: string;
  variants: Array<{
    height: number;
    mimeType: string;
    sizeBytes: number;
    variant: string;
    width: number;
  }>;
};

type ReadUrlResponse = {
  mimeType: string;
  url: string;
  variant: string;
};

export async function optimizeImage(assetId: string) {
  return browserApi<OptimizeResponse>(
    `/api/v1/files/${assetId}/optimize`,
    { method: "POST" },
  );
}

export async function getImageUrl(assetId: string, variant = "THUMBNAIL") {
  return browserApi<ReadUrlResponse>(
    `/api/v1/files/${assetId}/url?variant=${variant}`,
  );
}
