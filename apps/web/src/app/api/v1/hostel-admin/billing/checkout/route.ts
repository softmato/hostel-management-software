import type { NextRequest } from "next/server";

import { requireHostelAdminPrincipal } from "@/lib/api-auth";
import { handleRouteError, progressResponse } from "@/lib/api-response";
import { openSubscriptionCheckout } from "@/modules/billing/subscription-payment.service";
import { invoiceIdFor } from "@/modules/billing/subscription.service";

export const runtime = "nodejs";

/**
 * *Pay* on the portal's plan billing — a Softmato checkout for the hostel's
 * open invoice, scoped the same way as `pay-instructions` beside it.
 *
 * No body and no amount: the invoice is found on the server and Softmato reads
 * the figure from it. Streams its steps to the hand-off screen when asked.
 */
export async function POST(request: NextRequest) {
  try {
    const principal = await requireHostelAdminPrincipal(request);
    const hostelId = principal.hostelIds?.[0];

    if (!hostelId) {
      throw Object.assign(new Error("No hostel in scope."), { errorCode: "NO_HOSTEL", status: 400 });
    }

    return progressResponse(
      request,
      async (step) => openSubscriptionCheckout(await invoiceIdFor(hostelId), principal.userId, step),
      "Checkout opened",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
