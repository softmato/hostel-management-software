import type { NextRequest } from "next/server";
import { z } from "zod";

import { ApiAuthError } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { getBearerToken, verifyPurposeToken } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { updateResidentNightStatus } from "@/modules/safety/safety.service";
import { nightStatusUpdateSchema } from "@/modules/safety/safety.validation";
import { nightKey } from "@hostel/shared/night/night-window";

export const runtime = "nodejs";

/**
 * A button on the nightly prompt, answered from the notification shade.
 *
 * Authenticated by the answer token that resident's copy of the push carried
 * (`nightAnswerData` in `night-status-prompt.service.ts`), not by a session —
 * see there for why. The token names the resident, the hostel and the night,
 * and this route lets it do only what the buttons do: say inside or outside,
 * with an optional reason. Everything after that is the ordinary resident
 * write, including the resident-in-hostel check.
 */
const answerSchema = nightStatusUpdateSchema.extend({
  status: z.enum(["INSIDE_HOSTEL", "OUTSIDE_HOSTEL"]),
});

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request.headers.get("authorization"));
    const claims = token
      ? await verifyPurposeToken(token, "night-status-answer").catch(() => null)
      : null;

    if (
      !claims?.sub ||
      typeof claims.hostelId !== "string" ||
      typeof claims.night !== "string"
    ) {
      throw new ApiAuthError("This answer link is not valid.");
    }

    /*
     * The token outlives nothing — it expires when its night ends — but the
     * check is explicit anyway, so clock skew at 17:00 can never file one
     * night's answer against the next.
     */
    if (claims.night !== nightKey()) {
      throw new ApiAuthError(
        "That question was for an earlier night.",
        "NIGHT_STATUS_ANSWER_STALE",
        410,
      );
    }

    const input = answerSchema.parse(await request.json());
    const result = await updateResidentNightStatus(
      { ...input, source: "PUSH_ACTION" },
      { hostelIds: [claims.hostelId], role: Role.RESIDENT, userId: claims.sub },
    );

    return successResponse(result, "Night status updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
