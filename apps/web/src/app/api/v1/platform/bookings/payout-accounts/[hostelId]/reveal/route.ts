import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { revealHostelPayoutAccount } from "@/modules/bookings/payout-account.service";

type RouteContext = { params: Promise<{ hostelId: string }> };

export const runtime = "nodejs";

/**
 * The full account number, for a superadmin about to send a payout.
 *
 * POST, not GET, so nothing prefetches or caches it, and every call is written
 * to the audit log by the service.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { hostelId } = await context.params;
    const account = await revealHostelPayoutAccount(hostelId, principal);

    return successResponse({ account }, "Payout account", {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
