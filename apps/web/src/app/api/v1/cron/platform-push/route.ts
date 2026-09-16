import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { logger } from "@/lib/logger";
import { sweepBookings } from "@/modules/bookings/booking-sweep.service";
import { dispatchDueNoticePushes } from "@/modules/notices/notice-push.service";
import { dispatchDuePlatformPushes } from "@/modules/notifications/platform-push.service";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Cron, every minute: sends superadmin pushes whose scheduled time has passed.
 *
 * Every minute because a push is timed to the minute the superadmin picked, and
 * an idle run is one indexed query. `notification-dispatch` calls the same
 * function every 15 minutes as a fallback; the claim in
 * `dispatchDuePlatformPushes` keeps the two from double-sending.
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

    const platformPushes = await dispatchDuePlatformPushes();
    // Hostel push notices ride the same every-minute tick.
    const noticePushes = await dispatchDueNoticePushes();
    // Booking deadlines and reminders ride it too. Caught on its own: a booking
    // failure must not report the pushes above as not sent.
    const bookings = await sweepBookings().catch((error: unknown) => {
      logger.error("Booking sweep failed.", {
        error: error instanceof Error ? error.message : String(error),
      });

      return { error: "Booking sweep failed." };
    });

    return successResponse(
      { ...platformPushes, bookings, noticePushes },
      "Scheduled pushes dispatched",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
