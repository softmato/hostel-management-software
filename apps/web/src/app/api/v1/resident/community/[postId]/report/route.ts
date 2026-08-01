import type { NextRequest } from "next/server";

import { requireResidentPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { reportPost } from "@/modules/community/community.service";
import { communityReportSchema } from "@/modules/community/community.validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ postId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireResidentPrincipal(request);
    const { postId } = await context.params;
    const input = communityReportSchema.parse(await request.json());
    const result = await reportPost(postId, input, principal);

    return successResponse(result, "Post reported");
  } catch (error) {
    return handleRouteError(error);
  }
}
