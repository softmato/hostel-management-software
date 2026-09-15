import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { deleteOwnComment } from "@/modules/community/community.service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ commentId: string; postId: string }>;
};

/** The author deletes their own comment. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { commentId, postId } = await context.params;
    const principal = await requireApiPrincipal(request);
    const result = await deleteOwnComment(postId, commentId, principal);

    return successResponse(result, "Comment deleted");
  } catch (error) {
    return handleRouteError(error);
  }
}
