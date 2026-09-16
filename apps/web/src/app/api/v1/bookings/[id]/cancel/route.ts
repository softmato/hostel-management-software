import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { cancelMyBooking } from "@/modules/bookings/booking-answer.service";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Cancels the person's own booking. Send `expectedRefund` from the screen; a moved figure answers 409. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireApiPrincipal(request);
    const { id } = await context.params;
    const booking = await cancelMyBooking(id, await request.json().catch(() => ({})), principal);

    return successResponse({ booking }, "Booking cancelled.");
  } catch (error) {
    return handleRouteError(error);
  }
}
