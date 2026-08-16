import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { resetEmailIdentityCache } from "@/lib/email-identity";
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

    // Both sections feed the email `From` header, and the sender caches it for
    // a minute. Dropping the cache here is what makes a rename visible in the
    // next email rather than in the next minute — invalidated unconditionally
    // because the cost is one settings read and the alternative is a stale
    // sender the admin cannot explain.
    if (section === "email" || section === "identity") {
      resetEmailIdentityCache();
    }

    return successResponse(result, "Site configuration saved");
  } catch (error) {
    return handleRouteError(error);
  }
}
