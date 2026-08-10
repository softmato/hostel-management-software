import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { setResidentMonthlyFee } from "@/modules/finance/resident-fee.service";
import { resolveAdminHostelId } from "@/modules/hostels/hostel.service";

export const runtime = "nodejs";

/**
 * The per-resident fee override.
 *
 * `monthlyFee: null` hands the resident back to the fee schedule — the one
 * operation the old schema could not express, since it accepted a non-negative
 * number and nothing else. Zero stays a real value: `resolveMonthlyCharge` tests
 * for null rather than falsiness so a deliberate free stay survives.
 */
const feeUpdateSchema = z.object({
  hostelId: z.string().optional(),
  monthlyFee: z.coerce.number().int().nonnegative().nullable(),
  reason: z.string().trim().max(500).optional(),
  /** Omitted → applies to every active resident in scope. */
  residentIds: z.array(z.string()).optional(),
});

export async function PATCH(request: NextRequest) {
  try {
    const principal = await requireHostelCapability(request, "manageFeeSchedule");
    const input = feeUpdateSchema.parse(await request.json());
    const hostelId = resolveAdminHostelId(principal, input.hostelId);

    const result = await setResidentMonthlyFee(
      {
        hostelId,
        monthlyFee: input.monthlyFee,
        reason: input.reason,
        residentIds: input.residentIds,
      },
      principal,
    );

    return successResponse(result, "Monthly fee updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
