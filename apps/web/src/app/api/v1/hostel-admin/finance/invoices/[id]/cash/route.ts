import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { recordCashPayment } from "@/modules/finance/cash-payment.service";
import { recordCashSchema } from "@/modules/finance/cash-payment.validation";

export const runtime = "nodejs";

/**
 * Record cash against an invoice (target §9.1, plan item 2.7).
 *
 * `recordCash`, which item 0.5 split out of the old blanket `verifyPayments`.
 * A `201` means the money is settled; a `200` with `pendingApproval` means it
 * was above the hostel's threshold and is waiting for a second person.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireHostelCapability(request, "recordCash");
    const { id } = await context.params;
    const input = recordCashSchema.parse(await request.json());

    const result = await recordCashPayment({ ...input, invoiceId: id }, principal);

    return successResponse(
      result,
      result.pendingApproval
        ? "Cash recorded — a second approver is required"
        : "Cash recorded",
      { status: result.pendingApproval ? 200 : 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
