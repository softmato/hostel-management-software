import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { deleteProduct, updateProduct } from "@/modules/store/store-admin.service";
import { storeProductUpdateSchema } from "@/modules/store/store.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ productId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { productId } = await context.params;
    const input = storeProductUpdateSchema.parse(await request.json());

    return successResponse(
      await updateProduct(productId, input, principal),
      "Product updated",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { productId } = await context.params;

    return successResponse(await deleteProduct(productId, principal), "Product deleted");
  } catch (error) {
    return handleRouteError(error);
  }
}
