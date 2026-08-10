import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { askResidentAboutClaim } from "@/modules/finance/statements/reconcile.service";

export const runtime = "nodejs";

/**
 * "Ask resident" on a claim with no matching transaction (target §11.5).
 *
 * `viewPayments`, not `approvePayments`: asking a question decides nothing and
 * changes no balance, and requiring the settle capability to send it would push
 * the chasing back onto whoever holds the money keys.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireHostelCapability(request, "viewPayments");
    const { id } = await context.params;

    return successResponse(await askResidentAboutClaim(id, principal), "Resident asked");
  } catch (error) {
    return handleRouteError(error);
  }
}
