import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { requireHostelStaffPrincipal } from "@/lib/api-auth";
import { assignMaintenanceProvider } from "@/modules/maintenance/maintenance.service";
import { maintenanceProviderAssignSchema } from "@/modules/maintenance/maintenance.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

/**
 * Sending a raised request to a contractor.
 *
 * Staff, like the status route beside it: the warden who raised the job is the
 * one who knows which plumber answers the phone, and gating this on the owner
 * would mean nothing moves while they are out. The service refuses a request
 * that already has somebody on it — see `assignMaintenanceProvider`.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelStaffPrincipal(request);
    const { id } = await context.params;
    const input = maintenanceProviderAssignSchema.parse(await request.json());
    const result = await assignMaintenanceProvider(id, input, principal);

    return successResponse(result, "Provider assigned");
  } catch (error) {
    return handleRouteError(error);
  }
}
