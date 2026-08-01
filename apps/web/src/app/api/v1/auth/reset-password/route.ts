import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { AuthServiceError, resetPasswordWithToken } from "@/modules/auth/auth.service";
import { resetPasswordSchema } from "@hostel/shared/schemas/auth.schema";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const input = resetPasswordSchema.parse(await request.json());
    const result = await resetPasswordWithToken(input);

    return successResponse(result, "Password reset. You can now log in.");
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return errorResponse(error.message, error.errorCode, error.status);
    }

    return handleRouteError(error);
  }
}
