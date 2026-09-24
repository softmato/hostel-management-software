import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { deletePerk, updatePerk } from "@/modules/offer-program/offer-program.service";
import { perkUpdateSchema } from "@/modules/offer-program/offer-program.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ perkId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { perkId } = await context.params;
    const input = perkUpdateSchema.parse(await request.json());

    return successResponse(await updatePerk(perkId, input, principal), "Perk updated");
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { perkId } = await context.params;

    return successResponse(await deletePerk(perkId, principal), "Perk deleted");
  } catch (error) {
    return handleRouteError(error);
  }
}
