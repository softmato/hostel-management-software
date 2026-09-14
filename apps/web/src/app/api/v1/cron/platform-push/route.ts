import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
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

    return successResponse(await dispatchDuePlatformPushes(), "Scheduled pushes dispatched");
  } catch (error) {
    return handleRouteError(error);
  }
}
