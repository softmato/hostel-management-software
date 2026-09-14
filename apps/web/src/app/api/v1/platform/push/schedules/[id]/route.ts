import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { platformPushScheduleActionSchema } from "@/modules/notifications/notification.validation";
import { updatePlatformPushSchedule } from "@/modules/notifications/platform-push.service";

export const runtime = "nodejs";

/** Pause, resume or cancel a scheduled push. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperadminPrincipal(request);
    const { id } = await params;
    const { action } = platformPushScheduleActionSchema.parse(await request.json());

    return successResponse(await updatePlatformPushSchedule(id, action), "Schedule updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
