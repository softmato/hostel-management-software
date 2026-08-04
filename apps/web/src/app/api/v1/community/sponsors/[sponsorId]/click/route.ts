import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { recordSponsorClick } from "@/modules/sponsors/sponsor.service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ sponsorId: string }> };

/**
 * Click-through counter for a sponsor card. Unauthenticated on purpose — a
 * signed-out visitor clicking an ad is exactly the traffic a sponsor is paying
 * for, and requiring an account would undercount it to nearly nothing.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { sponsorId } = await context.params;
    const result = await recordSponsorClick(sponsorId);

    return successResponse(result, "Click recorded");
  } catch (error) {
    return handleRouteError(error);
  }
}
