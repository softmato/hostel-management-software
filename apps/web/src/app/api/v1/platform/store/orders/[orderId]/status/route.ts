import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { updateOrderStatus } from "@/modules/store/order.service";
import { storeOrderStatusSchema } from "@/modules/store/store.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ orderId: string }> };

/**
 * Moving an order along. The legal moves live in `store-status.ts`, not here -
 * the phone greys out buttons from the same table, so a transition the UI offers
 * and the API refuses is impossible by construction.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { orderId } = await context.params;
    const input = storeOrderStatusSchema.parse(await request.json());

    return successResponse(
      await updateOrderStatus(orderId, input, principal),
      "Order updated",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
