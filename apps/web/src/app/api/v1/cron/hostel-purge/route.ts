import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { runHostelArchivePurge } from "@/modules/hostels/hostel-purge.service";

export const runtime = "nodejs";
// A hostel is eighty-odd collections plus a round-trip to R2 for every photo it
// ever had. A batch of them needs the full window.
export const maxDuration = 60;

/**
 * Cron: permanently erase hostels whose 60-day archive grace period has run
 * out. Daily, alongside `account-purge`.
 *
 * A hostel qualifies only once `purgeScheduledAt` is set and past — a hostel
 * archived before that field existed has no purge date and is never swept up
 * by accident.
 *
 * Auth: `x-cron-secret` header only — see `docs/CRON.md`.
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

    const result = await runHostelArchivePurge();

    return successResponse(result, "Hostel archive purge processed");
  } catch (error) {
    return handleRouteError(error);
  }
}
