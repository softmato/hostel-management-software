import type { NextRequest } from "next/server";

import { loadApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse, errorResponse } from "@/lib/api-response";
import { UploadVerificationError, verifyUploadedObject } from "@/lib/uploads/verify";
import { computePerceptualHash, systemDocumentKind } from "@/modules/finance/evidence";
import { FileAssetModel } from "@hostel/db/models/FileAsset";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    assetId: string;
  }>;
};

/**
 * Closes a presigned upload (target §13.3, plan item 0.3).
 *
 * The presign route creates the `FileAsset` row before any bytes exist, so
 * until this runs the row is a reservation carrying only the client's own
 * description of the file. This reads the stored object back, rejects it if it
 * contradicts that description, records the real type, size and content hash,
 * and stamps `uploadCompletedAt` — which is what makes an asset usable as
 * evidence. A verification failure marks the asset DELETED rather than leaving
 * a half-trusted row behind.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await loadApiPrincipal(request);

    if (!principal) {
      return errorResponse("Authentication required", "UNAUTHENTICATED", 401);
    }

    const { assetId } = await context.params;
    const fileAsset = await FileAssetModel.findOne({
      _id: assetId,
      isDeleted: false,
      status: "ACTIVE",
    });

    if (!fileAsset) {
      return errorResponse("File asset not found", "NOT_FOUND", 404);
    }

    if (fileAsset.ownerId?.toString() !== principal.userId) {
      return errorResponse("Access denied", "FORBIDDEN", 403);
    }

    // Idempotent: a retried completion is a no-op, not a second read of the
    // object and not a chance to change a hash something already trusted.
    if (fileAsset.uploadCompletedAt) {
      return successResponse(
        {
          assetId: fileAsset._id.toString(),
          contentHash: fileAsset.contentHash,
          mimeType: fileAsset.mimeType,
          sizeBytes: fileAsset.sizeBytes,
        },
        "Upload already verified",
      );
    }

    let verified;

    try {
      verified = await verifyUploadedObject({
        bucket: fileAsset.bucket,
        declaredMimeType: fileAsset.mimeType,
        declaredSizeBytes: fileAsset.sizeBytes,
        key: fileAsset.key,
      });
    } catch (error) {
      if (error instanceof UploadVerificationError) {
        fileAsset.isDeleted = true;
        fileAsset.status = "DELETED";
        fileAsset.deletedAt = new Date();
        await fileAsset.save();

        return errorResponse(error.message, error.errorCode, error.status);
      }

      throw error;
    }

    fileAsset.contentHash = verified.contentHash;
    // Best-effort: a non-image, or anything sharp cannot decode, simply gets no
    // similarity check. The content hash is the one that has to be there.
    fileAsset.perceptualHash =
      (await computePerceptualHash(verified.bytes)) ?? undefined;
    // Recorded, not rejected: storing our own receipt is fine, submitting it as
    // proof of payment is not, and that is the finance module's call.
    fileAsset.systemDocumentKind =
      (await systemDocumentKind(verified.bytes)) ?? undefined;
    fileAsset.mimeType = verified.mimeType;
    fileAsset.sizeBytes = verified.sizeBytes;
    fileAsset.uploadCompletedAt = new Date();
    await fileAsset.save();

    return successResponse(
      {
        assetId: fileAsset._id.toString(),
        contentHash: verified.contentHash,
        mimeType: verified.mimeType,
        sizeBytes: verified.sizeBytes,
      },
      "Upload verified",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
