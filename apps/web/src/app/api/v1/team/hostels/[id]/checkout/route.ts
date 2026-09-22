import type { NextRequest } from "next/server";

import { requireTeamPrincipal } from "@/lib/api-auth";
import { handleRouteError, progressResponse } from "@/lib/api-response";
import { openSubscriptionCheckout } from "@/modules/billing/subscription-payment.service";
import { invoiceIdFor } from "@/modules/billing/subscription.service";
import { assertAgentFiledHostel } from "@/modules/team/team.service";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/**
 * *Collect online* — the agent opens Softmato checkout on their own phone and
 * the owner pays on it: a Fonepay QR scanned from their banking app, or their
 * wallet. Softmato confirms the money; nobody types an amount in.
 *
 * Only the agent who filed the hostel (or a superadmin), exactly as for the
 * rest of the work an agent does on it after publishing.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireTeamPrincipal(request);
    const { id } = await context.params;
    const hostelId = String(await assertAgentFiledHostel(principal, id));

    return progressResponse(
      request,
      async (step) => openSubscriptionCheckout(await invoiceIdFor(hostelId), principal.userId, step),
      "Checkout opened",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
