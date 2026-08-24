import type { NextRequest } from "next/server";

import { requireHostelAdminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { removeCartItem, updateCartItem } from "@/modules/store/cart.service";
import { storeCartItemUpdateSchema } from "@/modules/store/store.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ productId: string }> };

/** Absolute quantity, not a delta. `0` removes the line. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelAdminPrincipal(request);
    const { productId } = await context.params;
    const input = storeCartItemUpdateSchema.parse(await request.json());
    const requested = request.nextUrl.searchParams.get("hostelId") ?? undefined;

    return successResponse(
      await updateCartItem(productId, input, principal, requested),
      "Cart updated",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelAdminPrincipal(request);
    const { productId } = await context.params;
    const requested = request.nextUrl.searchParams.get("hostelId") ?? undefined;

    return successResponse(
      await removeCartItem(productId, principal, requested),
      "Removed from cart",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
