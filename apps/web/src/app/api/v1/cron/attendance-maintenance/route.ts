import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { runAttendanceMaintenance } from "@/modules/attendance/attendance-jobs.service";

export const runtime = "nodejs";
// Walks every hostel with tracking enabled, then purges expired rows.
export const maxDuration = 60;

/**
 * Cron: raise/close absence alerts and purge attendance logs past their
 * retention window (PHASES.md §4.1, PRIVACY_POLICY.md).
 *
 * Auth: `x-cron-secret` (or `Authorization: Bearer <CRON_SECRET>`) header only.
 * Scheduled via cron-job.org with a POST request — see `docs/CRON.md`.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = validateCronRequest(request);

    if (!auth.ok) {
      return errorResponse(
        auth.error,
        auth.status === 401 ? "UNAUTHORIZED" : "CRON_NOT_CONFIGURED",
        auth.status,
      );
    }

    const result = await runAttendanceMaintenance();

    return successResponse(result, "Attendance maintenance processed");
  } catch (error) {
    return handleRouteError(error);
  }
}
