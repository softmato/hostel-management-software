import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { runSettlementRecon } from "@/modules/finance/gateway/settlement-recon.service";

export const runtime = "nodejs";
// Re-asks the providers about closed attempts, so this is network-bound.
export const maxDuration = 300;

/**
 * Cron: weekly settlement reconciliation (target §10.2, plan item 6.7).
 *
 * **Neither eSewa nor Khalti publishes a bulk settlement report**, which is what
 * §10.2 assumed. So this reconciles the way that is actually available: it asks
 * again about every attempt we closed unpaid in the last fortnight, and checks
 * our intents and our ledger against each other.
 *
 * The recheck is the part that recovers money. An attempt that completed after
 * our sweep gave up is money in the hostel's account against an invoice that
 * says unpaid, and this is the only thing that finds it. It settles what it
 * finds; the two cross-checks only report, in keeping with the drift job — a
 * reconciliation that silently repairs destroys the evidence that the path
 * producing the discrepancy exists.
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

    const hostels = await runSettlementRecon();

    return successResponse(
      {
        findings: hostels.reduce((total, hostel) => total + hostel.findings, 0),
        hostels,
        recovered: hostels.reduce((total, hostel) => total + hostel.recovered, 0),
        rechecked: hostels.reduce((total, hostel) => total + hostel.rechecked, 0),
      },
      "Settlements reconciled",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
