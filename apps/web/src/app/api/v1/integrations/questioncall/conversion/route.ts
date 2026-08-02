import crypto from "node:crypto";
import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { recordQuestionCallConversion } from "@/modules/questioncall/questioncall.service";
import { questionCallConversionSchema } from "@/modules/questioncall/questioncall.validation";

export const runtime = "nodejs";

const HEADER = "x-questioncall-secret";

function safeEqual(a: string, b: string) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  // timingSafeEqual throws on a length mismatch, so compare lengths first.
  if (bufA.length === 0 || bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * QuestionCall calls this once a referred student completes signup, which is
 * the only way `converted` is ever set — the platform does not guess.
 *
 * Authenticated by a shared secret in a header (never a query param, which
 * would land in access logs). Same contract as the cron endpoints.
 */
export async function POST(request: NextRequest) {
  try {
    const configured = process.env.QUESTIONCALL_WEBHOOK_SECRET?.trim();

    if (!configured) {
      return errorResponse(
        "QuestionCall webhook is not configured.",
        "INTEGRATION_NOT_CONFIGURED",
        503,
      );
    }

    const provided = request.headers.get(HEADER)?.trim() ?? "";

    if (!safeEqual(provided, configured)) {
      return errorResponse("Unauthorized", "UNAUTHENTICATED", 401);
    }

    const input = questionCallConversionSchema.parse(await request.json());
    const result = await recordQuestionCallConversion(input);

    return successResponse(result, "QuestionCall conversion recorded");
  } catch (error) {
    return handleRouteError(error);
  }
}
