import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { approveClaim } from "@/modules/finance/review.service";

export const runtime = "nodejs";

/**
 * Verify a resident's payment claim (target §11.4, plan item 2.8).
 *
 * `approvePayments` — one of the six capabilities item 0.5 split out of the old
 * blanket `verifyPayments`. Settling is pinned to the claim still being PENDING,
 * so a double-click loses the race instead of crediting the invoice twice.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireHostelCapability(request, "approvePayments");
    const { id } = await context.params;

    return successResponse(await approveClaim(id, principal), "Payment verified");
  } catch (error) {
    return handleRouteError(error);
  }
}
