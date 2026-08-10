import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { bulkApproveClaims } from "@/modules/finance/review.service";
import { resolveAdminHostelId } from "@/modules/hostels/hostel.service";

export const runtime = "nodejs";
/** Each approval settles, recomputes and issues a receipt; a sweep of 50 is slow. */
export const maxDuration = 60;

const bulkApproveSchema = z.object({
  /**
   * Explicit ids, never "approve everything pending". The owner confirmed a
   * count and a total against what they were shown, and a filter evaluated
   * server-side could quietly include a row that arrived since.
   */
  eventIds: z.array(z.string()).min(1).max(100),
  hostelId: z.string().optional(),
});

/**
 * `Approve all` (target §11.4, plan item 3.5).
 *
 * The service re-derives which rows are all-green rather than trusting the ids,
 * and returns every skipped row with the check that stopped it.
 */
export async function POST(request: NextRequest) {
  try {
    const principal = await requireHostelCapability(request, "approvePayments");
    const input = bulkApproveSchema.parse(await request.json());
    const hostelId = resolveAdminHostelId(principal, input.hostelId);

    const result = await bulkApproveClaims(hostelId, input.eventIds, principal);

    return successResponse(
      result,
      `Approved ${result.approved.length} claim(s)` +
        (result.skipped.length > 0 ? `, ${result.skipped.length} left for review` : ""),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
