import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { reviewBookingPayment } from "@/modules/bookings/booking-review.service";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** `{ approve: true }`, or `{ approve: false, note }` with the reason the person will read. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { id } = await context.params;
    const booking = await reviewBookingPayment(id, await request.json(), principal);

    return successResponse({ booking }, "Payment checked.");
  } catch (error) {
    return handleRouteError(error);
  }
}
