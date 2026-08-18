import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { shouldExposeRefreshToken } from "@/lib/mobile-auth";
import { rateLimitPublicForm } from "@/lib/rate-limit";
import { applySessionCookies } from "@/lib/session-cookies";
import { loginGuardian } from "@/modules/guardian/guardian.service";
import { guardianLoginSchema } from "@/modules/guardian/guardian.validation";

export const runtime = "nodejs";

/**
 * Access-code sign-in for a guardian whose hostel handed them a code rather
 * than emailing an invitation.
 *
 * This route was written before `/auth/login` grew its protections and never
 * caught up. Three of them are here now, because a code-and-phone pair is a
 * *credential* and this is the only way to present it:
 *
 * **Rate limited, same 5-per-15-minutes as `/auth/login`.** The access code is
 * six characters and the phone number is not a secret — an unthrottled endpoint
 * is a guessing game whose prize is a session on somebody's guardian account,
 * and it was unthrottled until 2026-08-17.
 *
 * **The refresh token no longer goes to browsers.** It used to be returned in
 * the JSON body to every caller, which is what `/auth/login` deliberately avoids:
 * a refresh token readable by page scripts outlives an access-token rotation and
 * is the single most useful thing an XSS can steal. It is exposed only to the
 * mobile client, which has no cookie jar and no DOM.
 *
 * **Session cookies are set.** Without them a browser sign-in produced tokens
 * with nowhere to live, so the web has never been able to use this route at all.
 */
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const limited = rateLimitPublicForm(request, {
      limit: LOGIN_ATTEMPT_LIMIT,
      namespace: "guardian-login",
      windowMs: LOGIN_WINDOW_MS,
    });

    if (limited) {
      return limited;
    }

    const input = guardianLoginSchema.parse(await request.json());
    const result = await loginGuardian(input);
    const response = successResponse(
      {
        accessToken: result.accessToken,
        ...(shouldExposeRefreshToken(request.headers)
          ? { refreshToken: result.refreshToken }
          : {}),
        user: result.user,
      },
      "Guardian login successful",
    );

    return applySessionCookies(response, result);
  } catch (error) {
    return handleRouteError(error);
  }
}
