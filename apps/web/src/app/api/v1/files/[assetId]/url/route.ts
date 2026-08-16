import { NextResponse, type NextRequest } from "next/server";

import { loadApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, errorResponse } from "@/lib/api-response";
import { PLATFORM_ROLES } from "@/lib/permissions";
import { getPresignedReadUrl } from "@/lib/r2";
import { FileAssetModel } from "@hostel/db/models/FileAsset";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    assetId: string;
  }>;
};

const VALID_VARIANTS = new Set(["ORIGINAL", "THUMBNAIL", "MEDIUM", "LARGE"]);

function resolveVariantKey(
  fileAsset: {
    key: string;
    variants?: Array<{ key: string; variant: string }>;
  },
  variant: string,
) {
  if (variant === "ORIGINAL") {
    return fileAsset.key;
  }

  const match = fileAsset.variants?.find((v) => v.variant === variant);
  return match?.key ?? fileAsset.key;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { assetId } = await context.params;
    const { searchParams } = new URL(request.url);
    const rawVariant = searchParams.get("variant") ?? "ORIGINAL";
    const variant = rawVariant.toUpperCase();

    if (!VALID_VARIANTS.has(variant)) {
      return errorResponse(
        `Invalid variant. Must be one of: ${[...VALID_VARIANTS].join(", ")}`,
        "INVALID_VARIANT",
        422,
      );
    }

    const fileAsset = await FileAssetModel.findOne({
      _id: assetId,
      isDeleted: false,
      status: "ACTIVE",
    });

    if (!fileAsset) {
      return errorResponse("File asset not found", "NOT_FOUND", 404);
    }

    let targetUrl: string | null = null;

    if (fileAsset.accessLevel === "PUBLIC") {
      const resolvedKey = resolveVariantKey(fileAsset, variant);
      const publicBase = process.env.R2_PUBLIC_URL;

      if (publicBase) {
        targetUrl = `${publicBase}/${resolvedKey}`;
      }
    }

    if (!targetUrl) {
      const principal = await loadApiPrincipal(request);

      if (!principal) {
        return errorResponse(
          "Authentication required for private assets",
          "UNAUTHENTICATED",
          401,
        );
      }

      // Default-deny. Access is granted by a positive reason, never by the
      // absence of one: the previous form short-circuited on a missing
      // `hostelId`, and since payment proofs never carried one, every
      // authenticated user could read every resident's bank screenshot.
      // An unlabelled asset is now readable by its owner and the platform only.
      const isOwner = fileAsset.ownerId?.toString() === principal.userId;
      const isPlatform = PLATFORM_ROLES.includes(principal.role);
      const isSameHostel = fileAsset.hostelId
        ? principal.hostelIds.includes(fileAsset.hostelId.toString())
        : false;

      if (!isOwner && !isPlatform && !isSameHostel) {
        return errorResponse("Access denied", "FORBIDDEN", 403);
      }

      const resolvedKey = resolveVariantKey(fileAsset, variant);
      targetUrl = await getPresignedReadUrl(fileAsset.bucket, resolvedKey);
    }

    return NextResponse.redirect(targetUrl, 302);
  } catch (error) {
    return handleRouteError(error);
  }
}
