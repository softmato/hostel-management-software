import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { sweepPushReceipts } from "@/modules/notifications/push-receipts.service";

export const runtime = "nodejs";
// A backlog of tickets is read in batches of up to 1000 ids per request.
export const maxDuration = 60;

/**
 * Cron: read the delivery receipts for pushes Expo accepted.
 *
 * This is the only place in the product that can answer "did that notification
 * actually reach a phone". A ticket says Expo took the message; a receipt says
 * whether FCM or APNS did — and until this ran, nothing ever asked, which is
 * how every push in the product came to be silently undeliverable while the
 * send path counted them as sent. See `push-receipts.service.ts`.
 *
 * Run it a few minutes behind the traffic it is checking — receipts are not
 * ready immediately, and tickets younger than a minute are left for the next
 * pass. Hourly is enough; the rows survive for a day.
 *
 * Auth: `x-cron-secret` (or `Authorization: Bearer <CRON_SECRET>`) header only.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = validateCronRequest(request);

    if (!auth.ok) {
      return errorResponse(
        auth.error,
        auth.status === 401 ? "UNAUTHORIZED" : "CRON_NOT_CONFIGURED",
        auth.status,
      );
    }

    const result = await sweepPushReceipts();

    return successResponse(result, "Push receipts checked");
  } catch (error) {
    return handleRouteError(error);
  }
}
