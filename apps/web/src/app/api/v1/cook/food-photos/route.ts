import type { NextRequest } from "next/server";

import { assertApiRoles, requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { Role } from "@/lib/roles";
import { uploadCookFoodPhoto } from "@/modules/food/cook.service";
import { foodPhotoUploadSchema } from "@/modules/food/food.validation";

export const runtime = "nodejs";

/**
 * A photo of the meal, posted from the kitchen.
 *
 * The same `foodPhotoUploadSchema` the admin and resident routes use, so an
 * asset uploaded through the shared `/files` pipeline lands in the same feed —
 * the only difference is who is allowed to post and how their hostel is
 * resolved. `hostel-admin/food/photos` stays where it is; this is the cook's
 * door to the same place, because `manageFood` excludes them by definition.
 */
const ALLOWED_ROLES = [Role.COOK, Role.HOSTEL_ADMIN, Role.WARDEN];

export async function POST(request: NextRequest) {
  try {
    const principal = await requireApiPrincipal(request);
    assertApiRoles(principal, ALLOWED_ROLES);

    const input = foodPhotoUploadSchema.parse(await request.json());
    const result = await uploadCookFoodPhoto(input, principal);

    return successResponse(result, "Food photo uploaded", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
