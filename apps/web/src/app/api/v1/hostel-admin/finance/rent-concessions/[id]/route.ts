import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { deleteRentConcession } from "@/modules/finance/rent-concession.service";
import { resolveAdminHostelId } from "@/modules/hostels/hostel.service";

export const runtime = "nodejs";

/**
 * Removes a month's discount, putting that month back to full rent.
 *
 * Allowed for a month that has already been billed, and it changes nothing about
 * those invoices: each one carries the amount and the words it was issued with.
 * Refusing it would mean a screen that will not let an owner tidy a list for a
 * reason they cannot verify.
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
      await deleteRentConcession(hostelId, id),
      "Month discount removed",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
