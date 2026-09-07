import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { saveWebPushSubscription } from "@/modules/notifications/web-push-subscription.service";
import { webPushSubscribeSchema } from "@/modules/notifications/notification.validation";
import { isWebPushConfigured } from "@/modules/notifications/web-push.service";

export const runtime = "nodejs";

/**
 * A browser saying "you may notify me here".
 *
 * Refuses when VAPID is unset rather than storing the subscription for later.
 * A subscription is minted *against* a specific public key; one created while
 * the deployment had no key is not a subscription that starts working when a
 * key is added, it is a row that can never be sent to — and the person who
 * clicked "turn on notifications" would have been told it worked.
 */
export async function POST(request: NextRequest) {
  try {
    const principal = await requireApiPrincipal(request);

    if (!isWebPushConfigured()) {
      return errorResponse(
        "Browser notifications are not configured on this deployment.",
        "WEB_PUSH_NOT_CONFIGURED",
        503,
      );
    }

    const input = webPushSubscribeSchema.parse(await request.json());
    const result = await saveWebPushSubscription(
      input,
      principal,
      request.headers.get("user-agent"),
    );

    return successResponse(result, "Browser notifications are on", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
