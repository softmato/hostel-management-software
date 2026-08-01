import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { overrideAttendance } from "@/modules/attendance/attendance.service";
import { attendanceOverrideSchema } from "@/modules/attendance/attendance.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ residentId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "updateNightStatus");
    const { residentId } = await context.params;
    const input = attendanceOverrideSchema.parse(await request.json());
    const result = await overrideAttendance(residentId, input, principal);

    return successResponse(result, "Attendance overridden");
  } catch (error) {
    return handleRouteError(error);
  }
}
