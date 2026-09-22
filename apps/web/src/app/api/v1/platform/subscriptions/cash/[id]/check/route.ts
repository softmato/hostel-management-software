import type { NextRequest } from "next/server";

import { requirePlatformPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { checkFieldCash } from "@/modules/billing/cash-filing.service";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Asks Softmato about one cash payment now, instead of waiting for the webhook. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    await requirePlatformPrincipal(request);
    const { id } = await context.params;

    return successResponse({ result: await checkFieldCash(id) }, "Cash checked");
  } catch (error) {
    return handleRouteError(error);
  }
}
