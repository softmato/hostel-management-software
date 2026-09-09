import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { resolveOwnedHostel } from "@/modules/billing/subscription-access";
import {
  getSubscriptionState,
  issueSubscriptionInvoice,
} from "@/modules/billing/subscription.service";

type RouteContext = { params: Promise<{ hostelId: string }> };

export const runtime = "nodejs";

/**
 * *Pay now* — raises the invoice and emails it.
 *
 * This is where verification is enforced. The button is hidden until the hostel
 * is verified and a plan is chosen, but a client that posts anyway is refused
 * by `issueSubscriptionInvoice` in the same words the screen would have used —
 * a hidden control is a courtesy, not a check.
 *
 * Safe to call twice: an invoice already outstanding is returned rather than
 * duplicated, so a double-tapped button cannot raise two demands for one
 * payment.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireApiPrincipal(request);
    const { hostelId } = await context.params;

    await resolveOwnedHostel(hostelId, principal.userId);
    await issueSubscriptionInvoice(hostelId, principal.userId);

    const state = await getSubscriptionState(hostelId);

    return successResponse({ state }, "Invoice issued");
  } catch (error) {
    return handleRouteError(error);
  }
}
