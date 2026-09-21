import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import {
  getPresignedUploadUrl,
  getPublicUrl,
  publicBucket,
  withKeyPrefix,
} from "@/lib/r2";

export const runtime = "nodejs";

const APK_MIME = "application/vnd.android.package-archive";

const bodySchema = z.object({
  fileName: z.string().trim().regex(/\.apk$/i, "Choose an .apk file."),
  size: z.number().int().positive().max(300 * 1024 * 1024, "An APK over 300 MB is too big."),
});

/**
 * A presigned PUT for the Android APK, straight to the public bucket.
 *
 * Outside the shared upload pipeline on purpose: that pipeline sniffs every
 * file against an image/document allowlist, and an APK is neither. Only a
 * superadmin reaches this, and the URL it returns is what the site config's
 * `apps.androidApkUrl` points at once the form is saved.
 */
export async function POST(request: NextRequest) {
  try {
    await requireSuperadminPrincipal(request);

    const { fileName } = bodySchema.parse(await request.json());
    const key = withKeyPrefix(
      `app/${fileName.replace(/[^\w.-]+/g, "-").replace(/\.apk$/i, "")}-${Date.now()}.apk`,
    );

    return successResponse(
      {
        contentType: APK_MIME,
        uploadUrl: await getPresignedUploadUrl(publicBucket(), key, APK_MIME),
        url: getPublicUrl(key),
      },
      "Upload URL ready",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
