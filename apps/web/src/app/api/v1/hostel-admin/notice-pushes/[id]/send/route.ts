import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { sendNoticePushNow } from "@/modules/notices/notice-push.service";
import { noticePushScopeSchema } from "@/modules/notices/notice-push.validation";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

/** Sends a push notice immediately; its schedule is left as it is. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "manageNotices");
    const { id } = await context.params;
    const scope = noticePushScopeSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );

    return successResponse(
      await sendNoticePushNow(id, principal, scope.hostelId),
      "Push notice sent",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
