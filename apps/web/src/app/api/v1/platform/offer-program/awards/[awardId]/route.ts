import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { updateAward } from "@/modules/offer-program/offer-program.service";
import { awardUpdateSchema } from "@/modules/offer-program/offer-program.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ awardId: string }> };

/** `deliver` a gift, mark a fee-off `hostel-paid`, or `cancel` an unused award. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { awardId } = await context.params;
    const { action } = awardUpdateSchema.parse(await request.json());

    return successResponse(await updateAward(awardId, action, principal), "Offer updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
