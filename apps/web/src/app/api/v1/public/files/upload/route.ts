import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { NextRequest } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

import { handleRouteError, successResponse, errorResponse } from "@/lib/api-response";
import { rateLimitPublicForm } from "@/lib/rate-limit";
import { generateFileKey, getR2Client, publicBucket } from "@/lib/r2";
import { FileAssetModel } from "@hostel/db/models/FileAsset";

export const runtime = "nodejs";

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
];

const MAX_SIZE = 5 * 1024 * 1024;

function r2Configured() {
  return !!(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_BUCKET_PUBLIC
  );
}

export async function POST(request: NextRequest) {
  try {
    const rateLimited = rateLimitPublicForm(request, {
      namespace: "public-file-upload",
    });

    if (rateLimited) {
      return rateLimited;
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return errorResponse("File is required", "VALIDATION_ERROR", 422);
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return errorResponse(
        "File type not allowed. Accepted: JPEG, PNG, WebP, PDF, TXT",
        "FILE_TYPE_NOT_ALLOWED",
        422,
      );
    }

    if (file.size > MAX_SIZE) {
      return errorResponse("File size exceeds 5 MB limit", "FILE_TOO_LARGE", 422);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name;
    const mimeType = file.type;
    const sizeBytes = file.size;

    let url: string;

    if (r2Configured()) {
      // Always the public bucket: this route exists to serve hostel
      // registration documents back over an unsigned URL.
      const key = generateFileKey("public-uploads", fileName);
      const bucket = publicBucket();

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      });

      await getR2Client().send(command);

      const publicUrl = process.env.R2_PUBLIC_URL;
      url = publicUrl ? `${publicUrl}/${key}` : key;

      await FileAssetModel.create({
        storageProvider: "CLOUDFLARE_R2",
        bucket,
        key,
        fileName,
        mimeType,
        sizeBytes,
        accessLevel: "PUBLIC",
        status: "ACTIVE",
      });
    } else {
      const uploadDir = join(process.cwd(), "public", "uploads", "hostel-documents");
      if (!existsSync(uploadDir)) {
        await mkdir(uploadDir, { recursive: true });
      }

      const ext = fileName.split(".").pop()?.toLowerCase() ?? "bin";
      const uniqueName = `${crypto.randomUUID()}.${ext}`;
      const filePath = join(uploadDir, uniqueName);
      await writeFile(filePath, buffer);

      url = `/uploads/hostel-documents/${uniqueName}`;
    }

    return successResponse({ url, fileName, mimeType, sizeBytes }, "File uploaded", {
      status: 201,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
