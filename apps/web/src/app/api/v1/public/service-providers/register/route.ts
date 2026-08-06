import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { requireApiPrincipal } from "@/lib/api-auth";
import { rateLimitPublicForm } from "@/lib/rate-limit";
import { registerPublicServiceProvider } from "@/modules/service-providers/service-provider.service";
import { serviceProviderRegisterSchema } from "@/modules/service-providers/service-provider.validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const rateLimited = rateLimitPublicForm(request, {
      namespace: "public-service-provider-registration",
    });

    if (rateLimited) {
      return rateLimited;
    }

    const input = serviceProviderRegisterSchema.parse(await request.json());
    // "Public" here means "not role-restricted", not "unauthenticated": the form
    // is Google-gated in the UI and the account link is what everything
    // downstream hangs off — the applicant's own status lookup, the duplicate
    // check, and the ID card approval re-issues. An application with no account
    // behind it is unreachable by the person who filed it, so it is refused.
    const principal = await requireApiPrincipal(request);
    const result = await registerPublicServiceProvider(input, {
      userId: principal.userId,
    });

    return successResponse(result, "Service provider registration submitted", {
      status: 201,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
