import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { resolveOwnedHostel } from "@/modules/billing/subscription-access";
import { openSubscriptionCheckout } from "@/modules/billing/subscription-payment.service";
import { invoiceIdFor } from "@/modules/billing/subscription.service";

type RouteContext = { params: Promise<{ hostelId: string }> };

export const runtime = "nodejs";

/**
 * *Pay now* — opens a Softmato checkout and hands back where to send the owner.
 *
 * ## There is no confirm branch any more, and its absence is the point
 *
 * This endpoint used to take an `action`: `open` showed a mocked QR and
 * `confirm` was a button the payer pressed to say the scan had worked. That
 * second branch settled a payment on the strength of a browser saying so, and
 * it is gone. Settlement now arrives at `/api/v1/webhooks/softmato`, on a
 * signature verified over the raw bytes, or from a server-side transaction
 * read on the return page. **Nothing a client sends can mark money received.**
 *
 * ## No amount either
 *
 * `POST /v1/checkout` has no amount parameter — Softmato reads it from the
 * invoice. A client-supplied figure would let anyone who can reach this route
 * choose their own price, which is exactly the hole the API is shaped to
 * close. The body is empty on purpose.
 *
 * Safe to call repeatedly. A checkout session lives thirty minutes and is
 * closer to a cheque than to a link, so one is minted per press — including
 * retries — rather than stored and handed out twice.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireApiPrincipal(request);
    const { hostelId } = await context.params;

    await resolveOwnedHostel(hostelId, principal.userId);

    const invoiceId = await invoiceIdFor(hostelId);
    const checkout = await openSubscriptionCheckout(invoiceId, principal.userId);

    return successResponse(checkout, "Checkout opened");
  } catch (error) {
    return handleRouteError(error);
  }
}
