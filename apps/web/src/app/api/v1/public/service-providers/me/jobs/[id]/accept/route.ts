import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { requireApiPrincipal } from "@/lib/api-auth";
import { acceptServiceProviderJob } from "@/modules/service-providers/service-provider.service";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

/**
 * A provider taking an open job off the board. The service scopes it to the
 * caller's own approved provider record and wins the race atomically.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireApiPrincipal(request);
    const { id } = await context.params;
    const result = await acceptServiceProviderJob(principal.userId, id);

    return successResponse(result, "Job accepted");
  } catch (error) {
    return handleRouteError(error);
  }
}
