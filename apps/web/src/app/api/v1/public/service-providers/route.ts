import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { listPublicServiceProviders } from "@/modules/service-providers/service-provider.service";
import { publicServiceProviderListQuerySchema } from "@/modules/service-providers/service-provider.validation";

export const runtime = "nodejs";

/**
 * Public provider directory — no login required (PHASES.md §5.1). The response
 * carries no phone numbers; contact details stay on the hostel-admin endpoint.
 */
export async function GET(request: NextRequest) {
  try {
    const query = publicServiceProviderListQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    const result = await listPublicServiceProviders(query);

    return successResponse(result, "Service providers loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}
