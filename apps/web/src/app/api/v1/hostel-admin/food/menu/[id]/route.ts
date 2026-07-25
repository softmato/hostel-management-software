import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { updateFoodMenu } from "@/modules/food/food.service";
import { foodMenuUpdateSchema } from "@/modules/food/food.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "manageFood");
    const { id } = await context.params;
    const input = foodMenuUpdateSchema.parse(await request.json());
    const result = await updateFoodMenu(id, input, principal);

    return successResponse(result, "Food menu updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
