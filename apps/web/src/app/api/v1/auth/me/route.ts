import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { getBearerToken, readAccessTokenCookie } from "@/lib/auth";
import { AuthServiceError, getCurrentUser } from "@/modules/auth/auth.service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const accessToken =
      getBearerToken(request.headers.get("authorization")) ??
      readAccessTokenCookie(request.cookies);

    if (!accessToken) {
      return errorResponse("Access token is missing.", "UNAUTHENTICATED", 401);
    }

    const user = await getCurrentUser(accessToken);

    return successResponse({ user }, "Authenticated user loaded");
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return errorResponse(error.message, error.errorCode, error.status);
    }

    return handleRouteError(error);
  }
}
