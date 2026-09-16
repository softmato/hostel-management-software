import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { submitBookingPayment } from "@/modules/bookings/booking.service";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Sends the payment screenshot (`BOOKING_PAYMENT_PROOF`, uploaded first) for checking. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireApiPrincipal(request);
    const { id } = await context.params;
    const booking = await submitBookingPayment(id, await request.json(), principal);

    return successResponse({ booking }, "Screenshot sent. We will check it and email you.");
  } catch (error) {
    return handleRouteError(error);
  }
}
