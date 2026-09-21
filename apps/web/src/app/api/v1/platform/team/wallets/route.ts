import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { listTeamWallets } from "@/modules/team/team-commission.service";

export const runtime = "nodejs";

/** Every field agent's commission wallet, and the rate in force. */
export async function GET(request: NextRequest) {
  try {
    await requireSuperadminPrincipal(request);

    return successResponse(await listTeamWallets(), "Wallets loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}
