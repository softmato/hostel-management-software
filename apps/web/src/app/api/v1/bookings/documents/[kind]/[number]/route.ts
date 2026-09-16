import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-response";
import {
  bookingDocumentResponse,
  resolveBookingDocument,
} from "@/modules/bookings/booking-documents.service";

type RouteContext = { params: Promise<{ kind: string; number: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The person who booked: their invoice, receipt and refund note. Nobody else's. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireApiPrincipal(request);
    const { kind, number } = await context.params;

    return bookingDocumentResponse(
      await resolveBookingDocument(kind, decodeURIComponent(number), { userId: principal.userId }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
