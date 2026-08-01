import type { NextRequest } from "next/server";

import { requireResidentPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { recordConsent } from "@/modules/attendance/attendance.service";
import { consentSchema } from "@/modules/attendance/attendance.validation";

export const runtime = "nodejs";

/** Grants or withdraws a consent. Every call appends a new ConsentLog row. */
export async function POST(request: NextRequest) {
  try {
    const principal = await requireResidentPrincipal(request);
    const input = consentSchema.parse(await request.json());
    const result = await recordConsent(input, principal);

    return successResponse(result, "Consent recorded");
  } catch (error) {
    return handleRouteError(error);
  }
}
