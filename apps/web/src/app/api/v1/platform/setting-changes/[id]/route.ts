import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { cancelSettingChange } from "@/modules/platform-config/setting-change.service";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Drops a change that is still waiting on its email confirm. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { id } = await context.params;

    return successResponse(await cancelSettingChange(id, principal), "Change cancelled");
  } catch (error) {
    return handleRouteError(error);
  }
}
