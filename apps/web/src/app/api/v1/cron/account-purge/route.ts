import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { runAccountDeletionPurge } from "@/modules/users/account-purge.service";

export const runtime = "nodejs";
// Each account touches a dozen collections; a batch of them needs room.
export const maxDuration = 60;

/**
 * Cron: permanently erase accounts whose 60-day grace period has run out
 * (ARCHITECTURE.md §13.1 step 4, PRIVACY_POLICY.md §8.3). Daily.
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

    const result = await runAccountDeletionPurge();

    return successResponse(result, "Account deletion purge processed");
  } catch (error) {
    return handleRouteError(error);
  }
}
