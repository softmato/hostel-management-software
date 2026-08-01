import type { NextRequest } from "next/server";

import { requireResidentPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { reactToPost } from "@/modules/community/community.service";
import { communityReactionSchema } from "@/modules/community/community.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ postId: string }> };

/** Idempotent toggle: posting the same reaction again clears it. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireResidentPrincipal(request);
    const { postId } = await context.params;
    const input = communityReactionSchema.parse(await request.json());
    const result = await reactToPost(postId, input, principal);

    return successResponse(result, "Reaction saved");
  } catch (error) {
    return handleRouteError(error);
  }
}
