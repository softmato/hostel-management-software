import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { runPlanDueReminders } from "@/modules/billing/plan-due-reminders.service";
import { runPaymentReminders } from "@/modules/finance/dunning.service";

export const runtime = "nodejs";
// Emails are external I/O; a large hostel roster needs more than the default.
export const maxDuration = 60;

/**
 * Cron: daily payment reminders and overdue chases (PHASES.md §3.1).
 * Idempotent within a day — reminders fire on an exact day offset from the due
 * date, overdue chases on a decaying schedule.
 *
 * Two sweeps on one schedule: residents' rent (`runPaymentReminders`) and hostel
 * owners' plan payments (`runPlanDueReminders`). They share the job because both
 * are "tell somebody their payment is coming due" at a sensible morning hour, and
 * a second cron-job.org entry would be one more thing to set up and forget.
 * Each runs even if the other throws, and the route still fails loudly if either
 * did.
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

    const [residents, plans] = await Promise.allSettled([
      runPaymentReminders(),
      runPlanDueReminders(),
    ]);

    if (residents.status === "rejected") {
      throw residents.reason;
    }

    if (plans.status === "rejected") {
      throw plans.reason;
    }

    return successResponse(
      { ...residents.value, plans: plans.value },
      "Payment reminders processed",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
