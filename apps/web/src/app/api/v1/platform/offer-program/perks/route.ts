import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { createPerk } from "@/modules/offer-program/offer-program.service";
import { perkCreateSchema } from "@/modules/offer-program/offer-program.validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const input = perkCreateSchema.parse(await request.json());

    return successResponse(await createPerk(input, principal), "Perk created", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
