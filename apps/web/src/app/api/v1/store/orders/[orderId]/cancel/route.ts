import type { NextRequest } from "next/server";

import { requireHostelAdminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { cancelOrder } from "@/modules/store/order.service";
import { storeOrderCancelSchema } from "@/modules/store/store.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ orderId: string }> };

/**
 * The buyer pulling their own order back. Narrower than the platform's cancel -
 * see `canBuyerCancelStoreOrder`: once it is with a courier this refuses, and
 * says to call instead.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelAdminPrincipal(request);
    const { orderId } = await context.params;
    const input = storeOrderCancelSchema.parse(await request.json().catch(() => ({})));

    return successResponse(await cancelOrder(orderId, input, principal), "Order cancelled");
  } catch (error) {
    return handleRouteError(error);
  }
}
