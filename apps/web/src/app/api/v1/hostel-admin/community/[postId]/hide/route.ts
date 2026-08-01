import type { NextRequest } from "next/server";

import { requireHostelStaffPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import {
  hideCommunityPost,
  unhideCommunityPost,
} from "@/modules/community/community.service";
import { communityHideSchema } from "@/modules/community/community.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ postId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelStaffPrincipal(request);
    const { postId } = await context.params;
    const input = communityHideSchema.parse(await request.json());
    const result = await hideCommunityPost(postId, input, principal);

    return successResponse(result, "Post hidden");
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Restores a post that was hidden in error and dismisses its open reports. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelStaffPrincipal(request);
    const { postId } = await context.params;
    const input = communityHideSchema.parse(await request.json());
    const result = await unhideCommunityPost(postId, input, principal);

    return successResponse(result, "Post restored");
  } catch (error) {
    return handleRouteError(error);
  }
}
