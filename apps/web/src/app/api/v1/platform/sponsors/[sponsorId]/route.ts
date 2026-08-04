import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { deleteSponsor, updateSponsor } from "@/modules/sponsors/sponsor.service";
import { sponsorUpdateSchema } from "@/modules/sponsors/sponsor.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ sponsorId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { sponsorId } = await context.params;
    const input = sponsorUpdateSchema.parse(await request.json());
    const result = await updateSponsor(sponsorId, input, principal);

    return successResponse(result, "Sponsor updated");
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { sponsorId } = await context.params;
    const result = await deleteSponsor(sponsorId, principal);

    return successResponse(result, "Sponsor deleted");
  } catch (error) {
    return handleRouteError(error);
  }
}
