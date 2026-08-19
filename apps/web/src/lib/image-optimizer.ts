import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { getR2Client } from "@/lib/r2";
import { loadSharp } from "@/lib/sharp";

export type VariantName = "THUMBNAIL" | "MEDIUM" | "LARGE";

export type ImageVariantRecord = {
  height: number;
  key: string;
  mimeType: string;
  sizeBytes: number;
  variant: VariantName;
  width: number;
};

const VARIANT_CONFIG: Record<
  VariantName,
  { fit: "cover" | "inside"; height: number; width: number }
> = {
  THUMBNAIL: { width: 150, height: 150, fit: "cover" },
  MEDIUM: { width: 640, height: 480, fit: "inside" },
  LARGE: { width: 1920, height: 1080, fit: "inside" },
};

function streamToBuffer(body: unknown): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = body as {
      on(event: "data", listener: (chunk: Buffer) => void): void;
      on(event: "end", listener: () => void): void;
      on(event: "error", listener: (err: Error) => void): void;
    };

    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export async function optimizeImage(
  bucket: string,
  sourceKey: string,
  mimeType: string,
): Promise<ImageVariantRecord[]> {
  if (!mimeType.startsWith("image/")) {
    return [];
  }

  // No resizer, no variants. The original is already stored and every reader
  // falls back to it, so this costs bandwidth rather than correctness — and it
  // is a far better outcome than failing the upload that triggered it.
  const sharp = await loadSharp();

  if (!sharp) {
    return [];
  }

  const client = getR2Client();
  const { Body } = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: sourceKey }),
  );

  if (!Body) {
    throw new Error("Empty response from R2");
  }

  const buffer = await streamToBuffer(Body);
  const baseKey = sourceKey.replace(/\.[^.]+$/, "");
  const variants: ImageVariantRecord[] = [];

  for (const [name, config] of Object.entries(VARIANT_CONFIG)) {
    const variant = name as VariantName;
    const variantKey = `${baseKey}-${variant.toLowerCase()}.webp`;

    const result = await sharp(buffer)
      .resize(config.width, config.height, {
        fit: config.fit,
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: variantKey,
        Body: result,
        ContentType: "image/webp",
        // Variants are content-addressed (unique key per source) and never
        // mutated, so they can be cached aggressively by the browser + CDN.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    const metadata = await sharp(result).metadata();

    variants.push({
      variant,
      key: variantKey,
      width: metadata.width ?? config.width,
      height: metadata.height ?? config.height,
      sizeBytes: result.length,
      mimeType: "image/webp",
    });
  }

  return variants;
}
