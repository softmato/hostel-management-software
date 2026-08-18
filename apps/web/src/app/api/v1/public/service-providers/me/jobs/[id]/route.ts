import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { requireApiPrincipal } from "@/lib/api-auth";
import { updateOwnServiceProviderJobStatus } from "@/modules/service-providers/service-provider.service";
import { serviceProviderJobStatusSchema } from "@/modules/service-providers/service-provider.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

/**
 * A provider moving their own job to CONTACTED or COMPLETED.
 *
 * Being signed in is the only gate, exactly as on the sibling `jobs` list: the
 * service resolves the caller's own approved provider record and matches the id
 * within their own assignments, so a job belonging to somebody else is a 404
 * rather than a 403 (RULES.md §3). There is nothing left for the route to check
 * that the service does not already scope.
 *
 * The narrowed status enum lives in `serviceProviderJobStatusSchema`, **not** in
 * `maintenanceStatusUpdateSchema` — that one is the hostel's and also accepts
 * CANCELLED, SCHEDULED and PENDING.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireApiPrincipal(request);
    const { id } = await context.params;
    const input = serviceProviderJobStatusSchema.parse(await request.json());
    const result = await updateOwnServiceProviderJobStatus(principal.userId, id, input);

    return successResponse(result, "Job updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
