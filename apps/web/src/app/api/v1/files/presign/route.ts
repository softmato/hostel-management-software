import type { NextRequest } from "next/server";

import { loadApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse, errorResponse } from "@/lib/api-response";
import { isFileAssetKind, isFinancialAssetKind } from "@/lib/file-asset-kinds";
import { validateFileAssetMetadata } from "@/lib/file-assets";
import { Role } from "@/lib/roles";
import { FileAssetModel } from "@hostel/db/models/FileAsset";
import { bucketForAccessLevel, getPresignedUploadUrl, generateFileKey } from "@/lib/r2";

export const runtime = "nodejs";

/**
 * Which hostel an asset belongs to, or null when it genuinely belongs to none
 * (a platform admin's own upload). An explicit `hostelId` must be one the caller
 * can reach; otherwise a caller scoped to exactly one hostel gets that one,
 * which covers every resident and single-hostel staff member without the client
 * having to know its own tenancy.
 */
function resolveAssetHostelId(
  principal: { hostelIds: string[]; role: Role },
  requested?: string,
) {
  if (requested) {
    const allowed =
      principal.role === Role.SUPERADMIN || principal.hostelIds.includes(requested);

    return allowed ? requested : null;
  }

  return principal.hostelIds.length === 1 ? principal.hostelIds[0] : null;
}

export async function POST(request: NextRequest) {
  try {
    const principal = await loadApiPrincipal(request);

    if (!principal) {
      return errorResponse("Authentication required", "UNAUTHENTICATED", 401);
    }

    const body = (await request.json()) as {
      accessLevel?: "PUBLIC" | "PRIVATE" | "PROTECTED";
      fileName?: string;
      hostelId?: string;
      kind?: string;
      mimeType?: string;
      sizeBytes?: number;
    };

    const {
      fileName,
      hostelId: requestedHostelId,
      kind,
      mimeType,
      sizeBytes,
      accessLevel,
    } = body;

    if (!fileName || !mimeType || !sizeBytes) {
      return errorResponse(
        "fileName, mimeType, and sizeBytes are required",
        "VALIDATION_ERROR",
        422,
      );
    }

    const validation = validateFileAssetMetadata({ mimeType, sizeBytes });

    if (validation) {
      return errorResponse(validation, "FILE_TYPE_NOT_ALLOWED", 422);
    }

    if (requestedHostelId && !resolveAssetHostelId(principal, requestedHostelId)) {
      return errorResponse("Access denied", "FORBIDDEN", 403);
    }

    const hostelId = resolveAssetHostelId(principal, requestedHostelId);

    // Money evidence that is not tenant-scoped cannot be authorized on read, so
    // it must never be created. Failing here is loud and fixable; failing on
    // read is a cross-tenant leak.
    if (isFinancialAssetKind(kind) && !hostelId) {
      return errorResponse(
        "A hostelId is required for payment-related uploads.",
        "HOSTEL_SCOPE_REQUIRED",
        422,
      );
    }

    // The bucket follows the access level, not the caller: a PRIVATE asset must
    // land somewhere with no public base URL. The previous form read one env var
    // with a hardcoded `?? "hostelhub-uploads"` fallback, which on a
    // misconfigured deployment presigned an upload to a bucket that did not
    // exist and failed at the PUT rather than here.
    const resolvedAccessLevel = accessLevel ?? "PRIVATE";
    const bucket = bucketForAccessLevel(resolvedAccessLevel);
    const key = generateFileKey("uploads", fileName);
    const fileAsset = await FileAssetModel.create({
      storageProvider: "CLOUDFLARE_R2",
      bucket,
      key,
      fileName,
      hostelId: hostelId ?? undefined,
      /*
       * Stored, not just checked. The kind decides who may read the bytes back
       * — `files/{assetId}/url` widens a `MAINTENANCE_NOTE` to the provider the
       * job was assigned to and nothing else — and until this line it was
       * inspected here and then thrown away, so no reader could ask.
       *
       * An unrecognised kind is dropped rather than refused: the allowlist is a
       * server concern and a client sending a kind this build has not heard of
       * gets the narrowest treatment, which is exactly what an absent kind
       * already means.
       */
      kind: isFileAssetKind(kind) ? kind : undefined,
      mimeType,
      sizeBytes,
      accessLevel: resolvedAccessLevel,
      status: "ACTIVE",
      createdBy: principal.userId,
      ownerId: principal.userId,
    });

    // No size handed to the signer — see `getPresignedUploadUrl`. The declared
    // `sizeBytes` is checked above and again against the stored object at
    // `/complete`, which is where a wrong one has to fail.
    const presignedUrl = await getPresignedUploadUrl(bucket, key, mimeType);

    return successResponse(
      {
        assetId: fileAsset._id.toString(),
        key,
        presignedUrl,
      },
      "Presigned URL generated",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
