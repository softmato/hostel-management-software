import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { voteOnComment } from "@/modules/community/community.service";
import { communityVoteSchema } from "@/modules/community/community.validation";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ commentId: string; postId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { commentId, postId } = await context.params;
    const principal = await requireApiPrincipal(request);
    const input = communityVoteSchema.parse(await request.json());
    const result = await voteOnComment(postId, commentId, input, principal);

    return successResponse(result, "Vote saved");
  } catch (error) {
    return handleRouteError(error);
  }
}
