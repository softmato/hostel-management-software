import type { NextRequest } from "next/server";

import { requireHostelAdminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import {
  cancelBookingByHostel,
  confirmBooking,
  declineBooking,
} from "@/modules/bookings/booking-answer.service";

type RouteContext = { params: Promise<{ action: string; id: string }> };

export const runtime = "nodejs";

const MESSAGES = {
  cancel: "Booking cancelled. The guest is refunded in full.",
  confirm: "Booking confirmed. The bed is held.",
  decline: "Booking declined. The guest is refunded in full.",
} as const;

/**
 * `confirm`, `decline` (optional `reason`) or `cancel` (`reason` required).
 * The service checks the booking is this admin's hostel's; a stranger's id
 * answers the same 404 as a missing one.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelAdminPrincipal(request);
    const { action, id } = await context.params;
    const body = await request.json().catch(() => ({}));

    if (action !== "confirm" && action !== "decline" && action !== "cancel") {
      return new Response("Not found", { status: 404 });
    }

    const booking =
      action === "confirm"
        ? await confirmBooking(id, principal)
        : action === "decline"
          ? await declineBooking(id, body, principal)
          : await cancelBookingByHostel(id, body, principal);

    return successResponse({ booking }, MESSAGES[action]);
  } catch (error) {
    return handleRouteError(error);
  }
}
