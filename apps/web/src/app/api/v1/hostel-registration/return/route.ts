import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { readReturnState } from "@/modules/billing/checkout-return.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What happened to the payment the owner has just come back from.
 *
 * Addressed by *our* invoice number, which is the only thing the return URL
 * carries and is a navigation hint rather than a claim — the answer comes from
 * a server-side read against Softmato, and ownership is checked before the
 * number is used at all.
 *
 * Never cached. A payment status that a CDN could hold for thirty seconds is a
 * payment status that tells the next reader about the last one's money.
 */
export async function GET(request: NextRequest) {
  try {
    const principal = await requireApiPrincipal(request);
    const invoiceNumber = new URL(request.url).searchParams
      .get("invoice")
      ?.trim();

    if (!invoiceNumber) {
      return successResponse({ state: { kind: "unknown" } }, "No invoice named");
    }

    const state = await readReturnState(principal.userId, invoiceNumber);

    return successResponse({ state }, "Return state read");
  } catch (error) {
    return handleRouteError(error);
  }
}
