import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { dispatchDueCampaigns } from "@/modules/notifications/notification-campaign.service";

export const runtime = "nodejs";
// A backlog of scheduled broadcasts fans out to many recipients per campaign.
export const maxDuration = 60;

/**
 * Cron: send scheduled notification campaigns whose delivery time has passed
 * (PHASES.md §5.1). Idempotent — each campaign is claimed out of SCHEDULED
 * before its receipts are written, so overlapping runs cannot double-send.
 *
 * Auth: `x-cron-secret` (or `Authorization: Bearer <CRON_SECRET>`) header only.
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

    const result = await dispatchDueCampaigns();

    return successResponse(result, "Scheduled notifications dispatched");
  } catch (error) {
    return handleRouteError(error);
  }
}
