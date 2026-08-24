import type { NextRequest } from "next/server";

import { requireHostelAdminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { addToCart } from "@/modules/store/cart.service";
import { storeCartAddSchema } from "@/modules/store/store.validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const principal = await requireHostelAdminPrincipal(request);
    const input = storeCartAddSchema.parse(await request.json());
    const requested = request.nextUrl.searchParams.get("hostelId") ?? undefined;

    return successResponse(await addToCart(input, principal, requested), "Added to cart");
  } catch (error) {
    return handleRouteError(error);
  }
}
