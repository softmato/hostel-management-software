import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { runGatewayHealth } from "@/modules/finance/gateway/gateway-health.service";

export const runtime = "nodejs";
// Counts per hostel, no provider calls. Daily, so latency is irrelevant.
export const maxDuration = 300;

/**
 * Cron: is each hostel's online checkout actually working (plan item 6.7)?
 *
 * **The failure this catches is invisible everywhere else.** A broken checkout
 * and a quiet month produce the same dashboard — no settlements, invoices
 * staying open, nobody complaining yet. The signal that separates them is
 * whether residents are *starting* payments that never complete, which is the
 * one number no other screen shows.
 *
 * Writes a `ReconciliationRun` per hostel and emails the owner when a provider is
 * failing, throttled to once a day per provider so a daily job stays readable.
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

    const hostels = await runGatewayHealth();

    return successResponse(
      {
        checked: hostels.reduce((total, hostel) => total + hostel.checked, 0),
        findings: hostels.reduce((total, hostel) => total + hostel.findings, 0),
        hostels,
        notified: hostels.reduce((total, hostel) => total + hostel.notified, 0),
      },
      "Gateway health checked",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
