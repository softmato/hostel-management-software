import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { rateLimitAuthAttempts } from "@/lib/rate-limit";
import { AuthServiceError, verifyEmailWithToken } from "@/modules/auth/auth.service";
import { verifyEmailSchema } from "@hostel/shared/schemas/auth.schema";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // The verification token is guessable given enough attempts.
    const limited = rateLimitAuthAttempts(request, "auth-verify-email");

    if (limited) {
      return limited;
    }

    const input = verifyEmailSchema.parse(await request.json());
    const result = await verifyEmailWithToken(input);

    return successResponse(result, "Email verified. You can now log in.");
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return errorResponse(error.message, error.errorCode, error.status);
    }

    return handleRouteError(error);
  }
}
