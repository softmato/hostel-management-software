import { handleRouteError, successResponse } from "@/lib/api-response";
import { getBookingGuide } from "@/modules/bookings/booking-guide.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How booking works, from the live settings. Public: the app's screen reads it signed out too. */
export async function GET() {
  try {
    return successResponse({ guide: await getBookingGuide() }, "How booking works");
  } catch (error) {
    return handleRouteError(error);
  }
}
