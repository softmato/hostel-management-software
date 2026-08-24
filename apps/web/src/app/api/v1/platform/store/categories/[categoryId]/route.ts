import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { deleteCategory, updateCategory } from "@/modules/store/store-admin.service";
import { storeCategoryUpdateSchema } from "@/modules/store/store.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ categoryId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { categoryId } = await context.params;
    const input = storeCategoryUpdateSchema.parse(await request.json());

    return successResponse(
      await updateCategory(categoryId, input, principal),
      "Category updated",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { categoryId } = await context.params;

    return successResponse(await deleteCategory(categoryId, principal), "Category deleted");
  } catch (error) {
    return handleRouteError(error);
  }
}
