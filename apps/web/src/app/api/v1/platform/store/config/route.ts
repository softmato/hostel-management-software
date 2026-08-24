import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { getStoreConfig, saveStoreConfig } from "@/modules/store/store-config";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireSuperadminPrincipal(request);

    return successResponse({ config: await getStoreConfig() }, "Store settings loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const result = await saveStoreConfig(await request.json(), principal.userId);

    return successResponse(result, "Store settings saved");
  } catch (error) {
    return handleRouteError(error);
  }
}
