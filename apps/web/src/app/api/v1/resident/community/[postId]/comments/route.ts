import type { NextRequest } from "next/server";

import { requireResidentPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { commentOnPost, listPostComments } from "@/modules/community/community.service";
import { communityCommentCreateSchema } from "@/modules/community/community.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ postId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireResidentPrincipal(request);
    const { postId } = await context.params;
    const result = await listPostComments(postId, principal);

    return successResponse(result, "Comments loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireResidentPrincipal(request);
    const { postId } = await context.params;
    const input = communityCommentCreateSchema.parse(await request.json());
    const result = await commentOnPost(postId, input, principal);

    return successResponse(result, "Comment added", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
