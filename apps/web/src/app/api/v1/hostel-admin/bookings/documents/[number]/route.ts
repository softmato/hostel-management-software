import type { NextRequest } from "next/server";

import { requireHostelAdminPrincipal } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-response";
import {
  bookingDocumentResponse,
  resolveBookingDocument,
} from "@/modules/bookings/booking-documents.service";

type RouteContext = { params: Promise<{ number: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A hostel's payout advice. The only booking paper a hostel reads. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelAdminPrincipal(request);
    const { number } = await context.params;

    return bookingDocumentResponse(
      await resolveBookingDocument("payout", decodeURIComponent(number), { hostelIds: principal.hostelIds }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
