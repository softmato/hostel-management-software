import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { runPaymentReminders } from "@/modules/finance/dunning.service";

export const runtime = "nodejs";
// Emails are external I/O; a large hostel roster needs more than the default.
export const maxDuration = 60;

/**
 * Cron: daily payment reminders and overdue chases (PHASES.md §3.1).
 * Idempotent within a day — reminders fire on an exact day offset from the due
 * date, overdue chases on a decaying schedule.
 *
 * Residents' rent only. Plan payment reminders, and the resident fee pushes,
 * are automatic rows on the superadmin Push tab, sent by `platform-push`.
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

    return successResponse(await runPaymentReminders(), "Payment reminders processed");
  } catch (error) {
    return handleRouteError(error);
  }
}
