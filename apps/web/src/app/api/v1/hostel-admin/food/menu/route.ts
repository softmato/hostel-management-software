import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { createFoodMenu, listFoodMenus } from "@/modules/food/food.service";
import {
  foodMenuCreateSchema,
  foodMenuListQuerySchema,
} from "@/modules/food/food.validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const principal = await requireHostelCapability(request, "manageFood");
    const query = foodMenuListQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const result = await listFoodMenus(query, principal);

    return successResponse(result, "Food menus loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireHostelCapability(request, "manageFood");
    const input = foodMenuCreateSchema.parse(await request.json());
    const result = await createFoodMenu(input, principal);

    return successResponse(result, "Food menu created", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
