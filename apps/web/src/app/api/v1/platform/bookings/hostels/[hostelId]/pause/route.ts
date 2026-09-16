import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { setHostelBookingPause } from "@/modules/bookings/booking-answer.service";

type RouteContext = { params: Promise<{ hostelId: string }> };

export const runtime = "nodejs";

/** `{ paused: true, reason }` turns a hostel's Book button off; `{ paused: false }` back on and forgives its strikes. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { hostelId } = await context.params;
    const input = (await request.json()) as { paused?: boolean };
    const pause = await setHostelBookingPause(hostelId, input, principal);

    return successResponse({ pause }, input.paused ? "Bookings paused." : "Bookings back on.");
  } catch (error) {
    return handleRouteError(error);
  }
}
