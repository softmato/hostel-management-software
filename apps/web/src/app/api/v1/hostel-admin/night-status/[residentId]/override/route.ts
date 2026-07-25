import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { overrideNightStatus } from "@/modules/safety/safety.service";
import { nightStatusOverrideSchema } from "@/modules/safety/safety.validation";

type RouteContext = {
  params: Promise<{
    residentId: string;
  }>;
};

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "updateNightStatus");
    const { residentId } = await context.params;
    const input = nightStatusOverrideSchema.parse(await request.json());
    const result = await overrideNightStatus(residentId, input, principal);

    return successResponse(result, "Night status overridden");
  } catch (error) {
    return handleRouteError(error);
  }
}
