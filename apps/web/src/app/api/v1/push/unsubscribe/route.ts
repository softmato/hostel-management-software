import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { revokeWebPushSubscription } from "@/modules/notifications/web-push-subscription.service";
import { webPushUnsubscribeSchema } from "@/modules/notifications/notification.validation";

export const runtime = "nodejs";

/**
 * Turning browser notifications off, and the same route sign-out calls.
 *
 * Deliberately tolerant: an endpoint that matches nothing still answers
 * success. The caller's goal is "this browser stops receiving", and a missing
 * row already satisfies it — reporting a failure would only give sign-out a way
 * to fail for a reason nobody can act on.
 */
export async function POST(request: NextRequest) {
  try {
    const principal = await requireApiPrincipal(request);
    const input = webPushUnsubscribeSchema.parse(await request.json());
    const result = await revokeWebPushSubscription(input, principal);

    return successResponse(result, "Browser notifications are off");
  } catch (error) {
    return handleRouteError(error);
  }
}
