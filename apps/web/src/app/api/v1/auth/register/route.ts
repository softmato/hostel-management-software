import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { rateLimitAuthAttempts } from "@/lib/rate-limit";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  accessTokenTtlSeconds,
  refreshTokenTtlSeconds,
} from "@/lib/auth";
import { shouldExposeRefreshToken } from "@/lib/mobile-auth";
import { AuthServiceError, registerPublicAccount } from "@/modules/auth/auth.service";
import { registerSchema } from "@/modules/auth/auth.validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // Registration sends mail; unbounded, it is a spam amplifier.
    const limited = rateLimitAuthAttempts(request, "auth-register");

    if (limited) {
      return limited;
    }

    const input = registerSchema.parse(await request.json());
    const result = await registerPublicAccount(input, {
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
      "Registration successful",
      { status: 201 },
    );

    response.cookies.set(ACCESS_TOKEN_COOKIE, result.accessToken, {
      httpOnly: true,
      maxAge: accessTokenTtlSeconds(),
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    response.cookies.set(REFRESH_TOKEN_COOKIE, result.refreshToken, {
      httpOnly: true,
      maxAge: refreshTokenTtlSeconds(),
      path: "/api/v1/auth",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return errorResponse(error.message, error.errorCode, error.status);
    }

    return handleRouteError(error);
  }
}
