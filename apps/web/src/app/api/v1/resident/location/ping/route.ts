import type { NextRequest } from "next/server";

import { requireResidentPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { recordLocationPing } from "@/modules/attendance/attendance.service";
import { locationPingSchema } from "@/modules/attendance/attendance.validation";

export const runtime = "nodejs";

/**
 * Background location ping from the mobile app (PHASES.md §4.1).
 * The coordinates are used to compute a zone and are never stored.
 */
export async function POST(request: NextRequest) {
  try {
    const principal = await requireResidentPrincipal(request);
    const input = locationPingSchema.parse(await request.json());
    const result = await recordLocationPing(input, principal);

    return successResponse(result, "Attendance recorded");
  } catch (error) {
    return handleRouteError(error);
  }
}
