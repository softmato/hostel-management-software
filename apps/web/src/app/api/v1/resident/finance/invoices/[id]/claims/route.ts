import type { NextRequest } from "next/server";

import { requireResidentPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { submitClaim } from "@/modules/finance/claim.service";
import { claimSubmitSchema } from "@/modules/finance/claim.validation";

export const runtime = "nodejs";

/**
 * A resident claiming they have paid (target §11.2, plan item 2.8).
 *
 * Replaces `POST /api/v1/resident/payments/[paymentId]/proof`. A replayed submit
 * returns `200` rather than a second `201`: the idempotency key collapsed it to
 * the claim that already exists, and telling the resident "created" twice would
 * be a lie about what happened.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireResidentPrincipal(request);
    const { id } = await context.params;
    const input = claimSubmitSchema.parse(await request.json());

    const result = await submitClaim(id, input, principal);

    return successResponse(
      result,
      result.created ? "Payment proof submitted" : "This proof was already submitted",
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
