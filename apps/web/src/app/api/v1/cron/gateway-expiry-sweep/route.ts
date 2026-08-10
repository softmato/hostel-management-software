import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { expireStaleIntents } from "@/modules/finance/gateway/intent.service";

export const runtime = "nodejs";
// Each stale attempt costs one call to its provider, and the batch is capped.
export const maxDuration = 120;

/**
 * Cron: close checkout attempts whose window has passed (plan item 6.2).
 *
 * **Asks the provider before writing anything off.** The failure this exists to
 * prevent is our callback endpoint being down for an hour while a resident pays
 * successfully — a clock-only sweep would record their payment as abandoned, and
 * they would have the receipt to prove otherwise. So the clock decides when to
 * *ask*, never what the answer is, and an attempt that turns out to have
 * succeeded settles here instead of expiring.
 *
 * Every 5 minutes. Auth: `x-cron-secret` header only — see `docs/CRON.md`.
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

    const result = await expireStaleIntents();

    return successResponse(result, "Checkout attempts swept");
  } catch (error) {
    return handleRouteError(error);
  }
}
