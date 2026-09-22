import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, progressResponse } from "@/lib/api-response";
import { openBookingCheckout } from "@/modules/bookings/booking-softmato.service";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** *Pay the booking fee* — a Softmato checkout for the guest's own booking. No body, no amount. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireApiPrincipal(request);
    const { id } = await context.params;

    // `?via=app`: the phone app, which comes back through a deep link.
    const via = new URL(request.url).searchParams.get("via") === "app" ? "app" : undefined;

    return progressResponse(request, (step) => openBookingCheckout(id, principal, step, via), "Checkout opened");
  } catch (error) {
    return handleRouteError(error);
  }
}
