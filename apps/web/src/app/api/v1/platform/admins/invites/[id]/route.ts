import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { revokePlatformAdminInvite } from "@/modules/users/platform-admin-invite.service";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { id } = await context.params;

    return successResponse(
      await revokePlatformAdminInvite(id, principal),
      "Invitation withdrawn",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
