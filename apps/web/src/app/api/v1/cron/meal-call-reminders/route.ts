import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { runMealCallReminders } from "@/modules/food/meal-call-reminder.service";

export const runtime = "nodejs";
// One Expo round trip per hostel whose meal just came due, and several hostels
// can share a serving time — 7pm dinner is 7pm dinner everywhere.
export const maxDuration = 60;

/**
 * Cron: tell each hostel's cooks that a meal's "Food ready" button has gone
 * live.
 *
 * The button unlocks on the hostel's own serving time (`meal-window.ts`), and
 * without this the kitchen only finds out by looking. Idempotent — each send is
 * claimed in `MealCallReminder` under the hostel, the meal and the Nepali day
 * before it goes out, so overlapping or retried runs cannot buzz a kitchen
 * twice.
 *
 * Must run **often**: a meal is only reminded about within 45 minutes of coming
 * due, so a cadence wider than that silently drops meals. Every 15 minutes.
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

    const result = await runMealCallReminders();

    return successResponse(result, "Meal call reminders processed");
  } catch (error) {
    return handleRouteError(error);
  }
}
