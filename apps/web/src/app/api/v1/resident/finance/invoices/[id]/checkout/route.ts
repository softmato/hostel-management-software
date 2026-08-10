import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireResidentPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { createPaymentIntent } from "@/modules/finance/gateway/intent.service";

export const runtime = "nodejs";

const checkoutSchema = z.object({
  provider: z.enum(["ESEWA", "FONEPAY", "KHALTI"]),
});

/**
 * Starts a gateway checkout for this invoice (target §11.6, plan item 6.2).
 *
 * POST rather than GET because it creates an attempt and calls the provider —
 * a prefetch or a double-tapped link must not be able to raise two of them
 * silently. Scoped to the calling resident's own invoice inside the service, so
 * there is no hostel parameter to get wrong here.
 *
 * The response is a handoff, never a settlement. Whatever comes back — a form to
 * post, a URL to follow, a QR to render — the money is not on the ledger until
 * the provider has been asked directly and agreed.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireResidentPrincipal(request);
    const { id } = await context.params;
    const { provider } = checkoutSchema.parse(await request.json());

    return successResponse(
      await createPaymentIntent(id, provider, principal),
      "Checkout ready",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
