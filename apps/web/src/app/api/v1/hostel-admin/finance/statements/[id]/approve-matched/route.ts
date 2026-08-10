import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { approveMatchedRows } from "@/modules/finance/statements/reconcile.service";

export const runtime = "nodejs";

/**
 * `Approve all` on the matched bucket (target §11.5).
 *
 * Re-derives the bucket server-side rather than accepting a list of event ids
 * from the screen — the same rule item 3.5 established for the review queue's
 * bulk sweep. A client that sends ids decides what "matched" means, and the one
 * thing a bulk action must never do is act on a definition the server did not
 * compute.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireHostelCapability(request, "approvePayments");
    const { id } = await context.params;

    return successResponse(await approveMatchedRows(id, principal), "Payments approved");
  } catch (error) {
    return handleRouteError(error);
  }
}
