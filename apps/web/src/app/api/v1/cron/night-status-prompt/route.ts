import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { validateCronRequest } from "@/lib/cron-auth";
import { runNightStatusPrompts } from "@/modules/safety/night-status-prompt.service";

export const runtime = "nodejs";
/*
 * One Expo round trip per hostel whose hour just came due, plus a bell row per
 * resident — and several hostels share an hour, because 8pm is 8pm everywhere.
 */
export const maxDuration = 60;

/**
 * Cron: ask each hostel's residents whether they are in tonight.
 *
 * The notification carries its category, so the answer is given from the
 * notification shade — `Inside`, `At home`, or `Outside…` with the inline text
 * field — without the app ever opening. See
 * `night-status-prompt.service.ts` for the whole design.
 *
 * Idempotent: each round of a hostel's night is claimed in `NightStatusPrompt`
 * before the send, so overlapping or retried runs cannot ask twice in a round.
 *
 * Must run **every 15 minutes**: whoever has not answered is asked again every
 * 15, 30 or 60 minutes (`promptRound`), and a cadence wider than the interval
 * silently skips rounds.
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

    const result = await runNightStatusPrompts();

    return successResponse(result, "Night status prompts processed");
  } catch (error) {
    return handleRouteError(error);
  }
}
