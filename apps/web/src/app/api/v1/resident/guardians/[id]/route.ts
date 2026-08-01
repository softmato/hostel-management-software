import type { NextRequest } from "next/server";

import { requireResidentPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import {
  revokeGuardianAccess,
  updateGuardianPermissions,
} from "@/modules/guardian/guardian-invite.service";
import { guardianPermissionsUpdateSchema } from "@/modules/guardian/guardian.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireResidentPrincipal(request);
    const { id } = await context.params;
    const input = guardianPermissionsUpdateSchema.parse(await request.json());
    const result = await updateGuardianPermissions(id, input, principal);

    return successResponse(result, "Guardian permissions updated");
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireResidentPrincipal(request);
    const { id } = await context.params;
    const result = await revokeGuardianAccess(id, principal);

    return successResponse(result, "Guardian access revoked");
  } catch (error) {
    return handleRouteError(error);
  }
}
