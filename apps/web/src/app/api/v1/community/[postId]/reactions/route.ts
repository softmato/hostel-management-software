import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { reactToPost } from "@/modules/community/community.service";
import { communityReactionSchema } from "@/modules/community/community.validation";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ postId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { postId } = await context.params;
    const principal = await requireApiPrincipal(request);
    const input = communityReactionSchema.parse(await request.json());
    const result = await reactToPost(postId, input, principal);

    return successResponse(result, "Reaction saved");
  } catch (error) {
    return handleRouteError(error);
  }
}
