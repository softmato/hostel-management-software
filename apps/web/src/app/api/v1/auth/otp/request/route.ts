import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { rateLimitAuthAttempts } from "@/lib/rate-limit";
import { AuthServiceError, requestOtpChallenge } from "@/modules/auth/auth.service";
import { otpRequestSchema } from "@/modules/auth/auth.validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // Each request sends an email or SMS — this is the spend limit.
    const limited = rateLimitAuthAttempts(request, "auth-otp-request");

    if (limited) {
      return limited;
    }

    const input = otpRequestSchema.parse(await request.json());
    const result = await requestOtpChallenge(input, {
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return successResponse(result, "OTP challenge created");
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return errorResponse(error.message, error.errorCode, error.status);
    }

    return handleRouteError(error);
  }
}
