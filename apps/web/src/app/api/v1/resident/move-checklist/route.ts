import type { NextRequest } from "next/server";

import { requireResidentPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { getResidentMoveChecklists } from "@/modules/move-checklist/move-checklist.service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const principal = await requireResidentPrincipal(request);
    const result = await getResidentMoveChecklists(principal);

    return successResponse(result, "Move checklist loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}
