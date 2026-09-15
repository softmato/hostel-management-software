import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { deleteNoticePush, updateNoticePush } from "@/modules/notices/notice-push.service";
import {
  noticePushScopeSchema,
  noticePushUpdateSchema,
} from "@/modules/notices/notice-push.validation";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "manageNotices");
    const { id } = await context.params;
    const input = noticePushUpdateSchema.parse(await request.json());

    return successResponse(await updateNoticePush(id, input, principal), "Push notice updated");
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "manageNotices");
    const { id } = await context.params;
    const scope = noticePushScopeSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );

    return successResponse(
      await deleteNoticePush(id, principal, scope.hostelId),
      "Push notice deleted",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
