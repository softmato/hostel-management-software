import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { awardOffer } from "@/modules/offer-program/offer-program.service";
import { awardCreateSchema } from "@/modules/offer-program/offer-program.validation";

export const runtime = "nodejs";

/** Gives one eligible resident a perk for a quarter. A fee-off is applied at once if a bill is open. */
export async function POST(request: NextRequest) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const input = awardCreateSchema.parse(await request.json());

    return successResponse(await awardOffer(input, principal), "Offer given", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
