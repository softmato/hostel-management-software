import type { NextRequest } from "next/server";

import { requireHostelAdminPrincipal } from "@/lib/api-auth";
import {
  errorResponse,
  handleRouteError,
  successResponse,
} from "@/lib/api-response";
import { submitPlanPaymentClaim } from "@/modules/billing/subscription-claim.service";

export const runtime = "nodejs";

/**
 * "I have paid our plan invoice — here is the screenshot."
 *
 * The manual lane's only write. It records a **claim**, not a payment: the row
 * lands `IN_REVIEW`, counts toward no balance, and clears no due until a
 * platform admin has looked at the proof. That is the same guarantee the
 * neighbouring `/pay` route makes in its own header comment — *nothing a client
 * sends can mark money received* — kept intact by a lane that is honest about
 * being a statement by the payer.
 *
 * ## No amount in the body
 *
 * A claim is for whatever is outstanding on the hostel's open invoice, and the
 * server reads that itself. A client-supplied figure would let the payer choose
 * what their own payment was worth, which is the hole `openSubscriptionCheckout`
 * refuses an amount to close.
 *
 * `proofAssetId` is required and must be a completed upload the caller owns,
 * scoped to their hostel. A claim with nothing to look at is a message, not
 * evidence, and there would be nothing for a reviewer to do with it.
 */
export async function POST(request: NextRequest) {
  try {
    const principal = await requireHostelAdminPrincipal(request);
    const hostelId = principal.hostelIds?.[0];

    if (!hostelId) {
      return errorResponse("No hostel in scope", "HOSTEL_SCOPE_REQUIRED", 403);
    }

    const body = (await request.json()) as {
      note?: string;
      proofAssetId?: string;
      reference?: string;
    };

    if (!body.proofAssetId) {
      return errorResponse(
        "Attach a screenshot of your payment before submitting.",
        "PROOF_REQUIRED",
        422,
      );
    }

    const claim = await submitPlanPaymentClaim(
      hostelId,
      {
        ...(body.note ? { note: body.note } : {}),
        proofAssetId: body.proofAssetId,
        ...(body.reference ? { reference: body.reference } : {}),
      },
      principal.userId,
    );

    return successResponse({ claim }, "Payment proof submitted");
  } catch (error) {
    return handleRouteError(error);
  }
}
