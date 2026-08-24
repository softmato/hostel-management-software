import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { listAllOrders } from "@/modules/store/order.service";
import { platformStoreOrderListQuerySchema } from "@/modules/store/store.validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireSuperadminPrincipal(request);

    const query = platformStoreOrderListQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );

    return successResponse(await listAllOrders(query), "Orders loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}
