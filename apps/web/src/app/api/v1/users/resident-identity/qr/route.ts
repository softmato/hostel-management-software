import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { getResidentIdentityQr } from "@/modules/users/resident-identity.service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const principal = await requireApiPrincipal(request);
    const result = await getResidentIdentityQr(principal.userId);

    return successResponse(result, "Resident QR ready");
  } catch (error) {
    return handleRouteError(error);
  }
}
