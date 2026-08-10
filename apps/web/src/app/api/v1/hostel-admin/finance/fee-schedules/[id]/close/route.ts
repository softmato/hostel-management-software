import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { closeFeeSchedule } from "@/modules/finance/fee-schedule.service";
import { feeScheduleCloseSchema } from "@/modules/finance/fee-schedule.validation";
import { resolveAdminHostelId } from "@/modules/hostels/hostel.service";

export const runtime = "nodejs";

/**
 * Closes a schedule without opening a successor (target §11.9, plan item 3.2).
 *
 * The hostel then has no open rate card, and the next billing run fails with
 * `FEE_SCHEDULE_MISSING` for every resident it cannot price. That is the
 * intended outcome (§7.3): a loud failure beats a silent wrong rate.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireHostelCapability(request, "manageFeeSchedule");
    const input = feeScheduleCloseSchema.parse(await request.json());
    const hostelId = resolveAdminHostelId(principal, input.hostelId);
    const { id } = await context.params;

    return successResponse(
      { schedule: await closeFeeSchedule(hostelId, id, input, principal) },
      "Rate card closed",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
