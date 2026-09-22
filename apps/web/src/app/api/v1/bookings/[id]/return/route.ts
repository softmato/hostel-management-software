import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, progressResponse } from "@/lib/api-response";
import { readBookingReturn } from "@/modules/bookings/booking-softmato.service";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What happened to the booking fee the guest has just come back from paying.
 * The answer is read from Softmato, never from the URL — see `readBookingReturn`.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireApiPrincipal(request);
    const { id } = await context.params;

    return progressResponse(
      request,
      async (step) => ({ state: await readBookingReturn(id, principal, step) }),
      "Return state read",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
