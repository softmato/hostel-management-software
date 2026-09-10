import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { restorePlatformHostel } from "@/modules/hostels/hostel.service";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

/**
 * Undo an archive, while the 60-day grace period is still running. Refused
 * once the purge is due — see `restorePlatformHostel`.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { id } = await context.params;
    const result = await restorePlatformHostel(id, principal);

    return successResponse(result, "Hostel restored");
  } catch (error) {
    return handleRouteError(error);
  }
}
