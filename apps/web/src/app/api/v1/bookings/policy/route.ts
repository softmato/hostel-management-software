import { handleRouteError, successResponse } from "@/lib/api-response";
import { getRefundPolicy } from "@/modules/bookings/booking-policy.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The refund policy with the live numbers, for the app's policy screen and the checkout. */
export async function GET() {
  try {
    return successResponse({ policy: await getRefundPolicy() }, "Refund policy");
  } catch (error) {
    return handleRouteError(error);
  }
}
