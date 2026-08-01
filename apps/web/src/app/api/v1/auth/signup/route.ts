import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { rateLimitPublicForm } from "@/lib/rate-limit";
import { AuthServiceError, signupWithEmailVerification } from "@/modules/auth/auth.service";
import { signupSchema } from "@hostel/shared/schemas/auth.schema";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const limited = rateLimitPublicForm(request, {
      limit: 10,
      namespace: "auth-signup",
      windowMs: 15 * 60 * 1000,
    });

    if (limited) {
      return limited;
    }

    const input = signupSchema.parse(await request.json());
    const result = await signupWithEmailVerification(input);

    return successResponse(
      result,
      "Account created. Check your inbox for the verification link.",
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return errorResponse(error.message, error.errorCode, error.status);
    }

    return handleRouteError(error);
  }
}
