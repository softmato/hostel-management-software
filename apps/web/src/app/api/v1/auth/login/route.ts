import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { shouldExposeRefreshToken } from "@/lib/mobile-auth";
import { rateLimitPublicForm } from "@/lib/rate-limit";
import { applySessionCookies } from "@/lib/session-cookies";
import { AuthServiceError, login } from "@/modules/auth/auth.service";
import { loginSchema } from "@/modules/auth/auth.validation";

export const runtime = "nodejs";

/** PHASES.md §1.1 security deliverable: 5 attempts per 15 minutes per IP. */
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const limited = rateLimitPublicForm(request, {
      limit: LOGIN_ATTEMPT_LIMIT,
      namespace: "auth-login",
      windowMs: LOGIN_WINDOW_MS,
    });

    if (limited) {
      return limited;
    }

    const input = loginSchema.parse(await request.json());
    const result = await login(input, {
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    const response = successResponse(
      {
        accessToken: result.accessToken,
        ...(shouldExposeRefreshToken(request.headers)
          ? { refreshToken: result.refreshToken }
          : {}),
        user: result.user,
      },
      "Login successful",
    );

    return applySessionCookies(response, result);
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return errorResponse(error.message, error.errorCode, error.status);
    }

    return handleRouteError(error);
  }
}
