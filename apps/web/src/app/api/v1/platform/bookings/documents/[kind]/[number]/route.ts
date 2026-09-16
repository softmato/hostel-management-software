import type { NextRequest } from "next/server";

import { requirePlatformPrincipal } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-response";
import { Role } from "@/lib/roles";
import {
  bookingDocumentResponse,
  resolveBookingDocument,
} from "@/modules/bookings/booking-documents.service";

type RouteContext = { params: Promise<{ kind: string; number: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Any booking paper, for a superadmin. Booking money is superadmin-only, moderators included. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requirePlatformPrincipal(request);
    const { kind, number } = await context.params;

    if (principal.role !== Role.SUPERADMIN) {
      return new Response("Not found", { status: 404 });
    }

    return bookingDocumentResponse(
      await resolveBookingDocument(kind, decodeURIComponent(number), { platform: true }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
