import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { voidInvoice } from "@/modules/finance/billing.service";
import { reverseEventSchema } from "@/modules/finance/cash-payment.validation";

export const runtime = "nodejs";

/**
 * Cancel an invoice that should never have been issued (target §9.2).
 *
 * `reversePayments`, alongside reversal: both undo something the hostel already
 * told a resident they owed, and item 0.5 gave that capability to nobody by
 * default for exactly that reason.
 *
 * Refuses when the invoice has settled payments — cancelling a paid obligation
 * would orphan money that is really in the hostel's account. Reverse first.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireHostelCapability(request, "reversePayments");
    const { id } = await context.params;
    const { reason } = reverseEventSchema.parse(await request.json());

    return successResponse(
      await voidInvoice(id, { hostelIds: principal.hostelIds, principal, reason }),
      "Invoice voided",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
