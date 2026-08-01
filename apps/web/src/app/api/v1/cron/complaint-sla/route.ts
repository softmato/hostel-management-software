import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { runComplaintSlaCheck } from "@/modules/complaints/complaint-sla.service";

export const runtime = "nodejs";
// Emails are external I/O; a backlog across many hostels needs the headroom.
export const maxDuration = 60;

/**
 * Cron: flag complaints past their SLA deadline (PHASES.md §4.1).
 * Idempotent — each complaint is flagged and alerted exactly once.
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

    const result = await runComplaintSlaCheck();

    return successResponse(result, "Complaint SLA check processed");
  } catch (error) {
    return handleRouteError(error);
  }
}
