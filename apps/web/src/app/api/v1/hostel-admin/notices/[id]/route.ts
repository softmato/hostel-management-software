import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { updateNotice } from "@/modules/notices/notice.service";
import { noticeUpdateSchema } from "@/modules/notices/notice.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "manageNotices");
    const { id } = await context.params;
    const input = noticeUpdateSchema.parse(await request.json());
    const result = await updateNotice(id, input, principal);

    return successResponse(result, "Notice updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
