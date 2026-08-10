import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { reverseEvent } from "@/modules/finance/payment-event.service";
import { reverseEventSchema } from "@/modules/finance/cash-payment.validation";

export const runtime = "nodejs";

/**
 * Reverse a settled payment (target §9.3, plan item 2.7).
 *
 * `reversePayments` — the capability item 0.5 gave to **nobody** by default,
 * because undoing money was never something proof verification should carry.
 * Writes a mirroring DEBIT rather than amending the original, voids the receipt,
 * and notifies the resident.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireHostelCapability(request, "reversePayments");
    const { id } = await context.params;
    const { reason } = reverseEventSchema.parse(await request.json());

    const result = await reverseEvent(id, { principal, reason });

    return successResponse(
      { balance: result.balance, reversalId: result.reversal._id.toString() },
      "Payment reversed",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
