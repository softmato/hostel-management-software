import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { resolveAttendanceAlert } from "@/modules/attendance/attendance.service";
import { attendanceAlertResolveSchema } from "@/modules/attendance/attendance.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "updateNightStatus");
    const { id } = await context.params;
    const input = attendanceAlertResolveSchema.parse(await request.json());
    const result = await resolveAttendanceAlert(id, input, principal);

    return successResponse(result, "Attendance alert resolved");
  } catch (error) {
    return handleRouteError(error);
  }
}
