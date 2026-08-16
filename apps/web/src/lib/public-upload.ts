import { PutObjectCommand } from "@aws-sdk/client-s3";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { generateFileKey, getR2Client, publicBucket } from "@/lib/r2";
import { siteUrl } from "@/lib/site";

function r2Configured() {
  return Boolean(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_BUCKET_PUBLIC &&
    process.env.R2_PUBLIC_URL,
  );
}

/**
 * Stores a server-generated public asset (today: activation QR images) and
 * returns an absolute URL that an email client can load.
 *
 * R2 when fully configured, otherwise `public/uploads/<prefix>/` on disk so the
 * flow still works end-to-end in local development. Returns `null` if neither
 * path succeeds — callers must degrade gracefully rather than fail the action
 * that produced the asset.
 */
export async function storePublicAsset(input: {
  body: Buffer;
  contentType: string;
  fileName: string;
  prefix: string;
}): Promise<string | null> {
  try {
    if (r2Configured()) {
      const key = generateFileKey(input.prefix, input.fileName);

      await getR2Client().send(
        new PutObjectCommand({
          Body: input.body,
          Bucket: publicBucket(),
          ContentType: input.contentType,
          Key: key,
        }),
      );

      return `${process.env.R2_PUBLIC_URL!.replace(/\/+$/, "")}/${key}`;
    }

    const uploadDir = join(process.cwd(), "public", "uploads", input.prefix);

    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const extension = input.fileName.split(".").pop()?.toLowerCase() ?? "bin";
    const uniqueName = `${crypto.randomUUID()}.${extension}`;

    await writeFile(join(uploadDir, uniqueName), input.body);

    return `${siteUrl()}/uploads/${input.prefix}/${uniqueName}`;
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        action: "public_asset_store_failed",
        message: error instanceof Error ? error.message : "Unknown storage error",
        prefix: input.prefix,
      }),
    );

    return null;
  }
}
