import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { resolveNotificationAction } from "@/modules/notifications/notification.service";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

const resolveSchema = z.object({
  actionKey: z.string().max(64).optional(),
  state: z.enum(["COMPLETED", "DISMISSED"]).optional(),
});

/**
 * Clear an ACTION notification out of the "Needs action" queue.
 *
 * Deliberately narrow: it records that the recipient dealt with the request, it
 * does not perform the underlying approval. The bell calls the domain endpoint
 * first and only then calls this, so a failed approval leaves the item in the
 * queue where it belongs.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireApiPrincipal(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const input = resolveSchema.parse(body);
    const result = await resolveNotificationAction(id, principal, input);

    return successResponse(result, "Notification resolved");
  } catch (error) {
    return handleRouteError(error);
  }
}
