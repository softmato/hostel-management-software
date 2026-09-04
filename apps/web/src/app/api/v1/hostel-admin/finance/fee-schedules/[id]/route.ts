import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { deleteFeeSchedule } from "@/modules/finance/fee-schedule.service";
import { resolveAdminHostelId } from "@/modules/hostels/hostel.service";

export const runtime = "nodejs";

/**
 * Drops rates that have not started yet.
 *
 * There is no PUT here and there is not going to be one. Correcting upcoming
 * rates is a POST to the collection with the same month — that path replaces the
 * unstarted card and leaves one row rather than a draft and its successor. This
 * exists for the other half: an owner who set next month's rates and has decided
 * they do not want them at all, who otherwise had no way back and would have had
 * to wait for the month to arrive.
 *
 * Rates that have started are refused by the service, not here, because that is
 * the rule and not the routing.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireHostelCapability(request, "manageFeeSchedule");
    const { id } = await context.params;
    const hostelId = resolveAdminHostelId(
      principal,
      request.nextUrl.searchParams.get("hostelId") ?? undefined,
    );

    return successResponse(
      await deleteFeeSchedule(hostelId, id, principal),
      "Upcoming rates deleted",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
