import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { NextRequest } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

import { loadApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse, errorResponse } from "@/lib/api-response";
import { generateFileKey, getR2Client } from "@/lib/r2";
import { hashBytes } from "@/lib/uploads/verify";
import { computePerceptualHash, systemDocumentKind } from "@/modules/finance/evidence";
import { FileAssetModel } from "@hostel/db/models/FileAsset";

export const runtime = "nodejs";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

const MAX_SIZE = 10 * 1024 * 1024;

function r2Configured() {
  return !!(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_BUCKET_NAME
  );
}

export async function POST(request: NextRequest) {
  try {
    const principal = await loadApiPrincipal(request);
    if (!principal) {
      return errorResponse("Authentication required", "UNAUTHENTICATED", 401);
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const accessLevel = (formData.get("accessLevel") as string) ?? "PUBLIC";

    if (!file) {
      return errorResponse("File is required", "VALIDATION_ERROR", 422);
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return errorResponse(
        "File type not allowed. Accepted: JPEG, PNG, WebP, PDF",
        "FILE_TYPE_NOT_ALLOWED",
        422,
      );
    }

    if (file.size > MAX_SIZE) {
      return errorResponse("File size exceeds 10 MB limit", "FILE_TOO_LARGE", 422);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name;
    const mimeType = file.type;
    const sizeBytes = file.size;

    let url: string;

    if (r2Configured()) {
      const key = generateFileKey("uploads", fileName);
      const bucket = process.env.R2_BUCKET_NAME!;

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
        accessLevel,
        status: "ACTIVE",
        createdBy: principal.userId,
        ownerId: principal.userId,
        // The bytes passed through this process, so type, size and hash are
        // measured rather than declared — no separate verification leg needed.
        contentHash: hashBytes(buffer),
        perceptualHash: (await computePerceptualHash(buffer)) ?? undefined,
        systemDocumentKind: (await systemDocumentKind(buffer)) ?? undefined,
        uploadCompletedAt: new Date(),
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
