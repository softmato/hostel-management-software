import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { requirePlatformPrincipal } from "@/lib/api-auth";
import { publishPlatformHostel } from "@/modules/hostels/hostel.service";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requirePlatformPrincipal(request);
    const { id } = await context.params;
    const result = await publishPlatformHostel(id, principal);

    return successResponse(
      result,
      result.notification.sent
        ? "Hostel published"
        : "Hostel published, but the owner could not be emailed",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
