import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { updateSiteConfigSection } from "@/modules/platform-config/site-config.service";

type RouteContext = {
  params: Promise<{
    section: string;
  }>;
};

export const runtime = "nodejs";

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { section } = await context.params;
    const body = await request.json();
    const result = await updateSiteConfigSection(section, body, principal);

    return successResponse(result, "Site configuration saved");
  } catch (error) {
    return handleRouteError(error);
  }
}
