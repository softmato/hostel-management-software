import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { logger } from "@/lib/logger";

export type ApiSuccess<T> = {
  success: true;
  message: string;
  data: T;
};

export type ApiError = {
  success: false;
  message: string;
  errorCode: string;
  details?: unknown;
};

export function successResponse<T>(
  data: T,
  message = "Request successful",
  init?: ResponseInit,
) {
  return NextResponse.json<ApiSuccess<T>>(
    {
      success: true,
      message,
      data,
    },
    init,
  );
}

export function errorResponse(
  message: string,
  errorCode = "BAD_REQUEST",
  status = 400,
  details?: unknown,
) {
  return NextResponse.json<ApiError>(
    {
      success: false,
      message,
      errorCode,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

export function handleRouteError(error: unknown) {
  if (error instanceof ZodError) {
    // `flatten()` only buckets by *top-level* key, so a failure inside a nested
    // object reads as `{ profile: [...] }` — useless for pointing a user at the
    // input that is actually wrong. `issues` carries the full dotted path.
    const issues = error.issues.map((issue) => ({
      message: issue.message,
      path: issue.path.join("."),
    }));
    const details = { ...error.flatten(), issues };

    // A bare "422" in the dev terminal says nothing about which field was
    // rejected, which makes form bugs needlessly hard to chase.
    logger.warn("Request validation failed", { issues });

    return errorResponse("Validation failed", "VALIDATION_ERROR", 422, details);
  }

  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    "errorCode" in error &&
    typeof error.errorCode === "string"
  ) {
    // `details` when the thrower attached any. An instant rejection is only
    // actionable if it says *which* earlier payment it collided with (target
    // §11.3), and that fact is known here and nowhere else.
    return errorResponse(
      error.message,
      error.errorCode,
      error.status,
      "details" in error ? error.details : undefined,
    );
  }

  logger.error("Unhandled API route error", { error });
  return errorResponse("Internal server error", "INTERNAL_SERVER_ERROR", 500);
}
