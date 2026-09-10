import type { NextRequest } from "next/server";

import { requirePlatformPrincipal } from "@/lib/api-auth";
import {
  errorResponse,
  handleRouteError,
  successResponse,
} from "@/lib/api-response";
import { reviewPlanPaymentClaim } from "@/modules/billing/subscription-claim.service";

type RouteContext = { params: Promise<{ paymentId: string }> };

export const runtime = "nodejs";

/**
 * A platform admin's answer to one manual payment claim.
 *
 * **This is the only route in the product that turns a screenshot into money
 * received**, and it is why the whole manual lane is safe to have: a claim
 * moves nothing until a named person, whose id is written onto the row and into
 * the audit log, says it did.
 *
 * Approving hands to `settlePayment` — the same function the Softmato webhook
 * calls — so the receipt, the activation and the publish all happen through one
 * path regardless of which lane the money arrived on. The hostel's due clears
 * because the balance genuinely moved.
 *
 * `note` rides along to the owner either way: as the reviewer's remark on an
 * approval, and as the reason in the "we could not confirm this" email on a
 * refusal, where it is by far the most useful sentence the message carries.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requirePlatformPrincipal(request);
    const { paymentId } = await context.params;

    const body = (await request.json()) as {
      approve?: boolean;
      note?: string;
    };

    if (typeof body.approve !== "boolean") {
      return errorResponse(
        "Say whether this claim is approved.",
        "VALIDATION_ERROR",
        422,
      );
    }

    const state = await reviewPlanPaymentClaim(
      paymentId,
      {
        approve: body.approve,
        ...(body.note ? { note: body.note } : {}),
      },
      principal.userId,
    );

    return successResponse(
      { state },
      body.approve ? "Payment confirmed" : "Claim marked unconfirmed",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
