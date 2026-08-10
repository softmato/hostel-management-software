import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { assignOrphanCredit } from "@/modules/finance/statements/reconcile.service";
import { assignOrphanSchema } from "@/modules/finance/statements/statement.validation";

export const runtime = "nodejs";

/**
 * Assign orphan money to an invoice (target §7 Tier D, §11.5).
 *
 * The suggestion beside this button is always a suggestion the owner confirms,
 * never an automatic match — so the invoice id arrives from the click, and the
 * settlement records `MANUAL_REVIEW` and who made it.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireHostelCapability(request, "approvePayments");
    const { id } = await context.params;
    const body = assignOrphanSchema.parse(await request.json());

    return successResponse(
      await assignOrphanCredit(id, { invoiceId: body.invoiceId, principal }),
      "Payment assigned",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
