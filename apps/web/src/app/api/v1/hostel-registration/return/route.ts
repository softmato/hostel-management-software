import type { NextRequest } from "next/server";

import { loadApiPrincipal, requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, progressResponse } from "@/lib/api-response";
import { readReturnState } from "@/modules/billing/checkout-return.service";
import { readCheckoutToken } from "@/modules/billing/plan-checkout.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What happened to the payment the owner has just come back from.
 *
 * Addressed by *our* invoice number, which is the only thing the return URL
 * carries and is a navigation hint rather than a claim — the answer comes from
 * a server-side read against Softmato, and ownership is checked before the
 * number is used at all. Streams its stages (confirm, record, activate) when
 * the return page asks.
 *
 * An owner who paid through the public plan checkout may not be signed in. The
 * checkout token that let them pay — sent back in `x-checkout-token`, never in
 * the URL — identifies them here instead, and ownership is still checked
 * against the invoice.
 *
 * Never cached. A payment status that a CDN could hold for thirty seconds is a
 * payment status that tells the next reader about the last one's money.
 */
export async function GET(request: NextRequest) {
  try {
    const checkoutToken = request.headers.get("x-checkout-token")?.trim();
    const principal =
      (await loadApiPrincipal(request)) ??
      (checkoutToken ? null : await requireApiPrincipal(request));
    const viewer = principal
      ? { role: principal.role, userId: principal.userId }
      : { role: "OWNER", userId: (await readCheckoutToken(checkoutToken as string)).ownerId };
    const invoiceNumber = new URL(request.url).searchParams
      .get("invoice")
      ?.trim();

    return progressResponse(
      request,
      async (step) => ({
        state: invoiceNumber
          ? await readReturnState(viewer, invoiceNumber, step)
          : { kind: "unknown" as const },
      }),
      "Return state read",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
