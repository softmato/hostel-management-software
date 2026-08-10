import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { runLedgerDrift } from "@/modules/finance/reconciliation/ledger-drift.service";

export const runtime = "nodejs";
// Scans every invoice of every hostel. Nightly, so latency is irrelevant and
// being cut off halfway is the only real failure mode.
export const maxDuration = 300;

/**
 * Cron: nightly ledger drift check (target §10.1, plan item 5.1).
 *
 * Reports, never corrects. The response is a per-hostel summary; the detail
 * lives in the `ReconciliationRun` rows this writes, one per hostel, which is
 * what makes a job that has been failing for a fortnight visible instead of
 * silent.
 *
 * Auth: `x-cron-secret` (or `Authorization: Bearer <CRON_SECRET>`) header only.
 * Scheduled via cron-job.org with a POST request — see `docs/CRON.md`.
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

    const hostels = await runLedgerDrift();

    return successResponse(
      {
        findings: hostels.reduce((total, hostel) => total + hostel.findings, 0),
        hostels,
        scanned: hostels.reduce((total, hostel) => total + hostel.scanned, 0),
      },
      "Ledger drift checked",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
