import type { NextRequest } from "next/server";

import { requireResidentPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { deleteOwnPost } from "@/modules/community/community.service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ postId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireResidentPrincipal(request);
    const { postId } = await context.params;
    const result = await deleteOwnPost(postId, principal);

    return successResponse(result, "Post removed");
  } catch (error) {
    return handleRouteError(error);
  }
}
