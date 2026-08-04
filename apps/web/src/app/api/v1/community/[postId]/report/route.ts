import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { reportPost } from "@/modules/community/community.service";
import { communityReportSchema } from "@/modules/community/community.validation";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ postId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { postId } = await context.params;
    const principal = await requireApiPrincipal(request);
    const input = communityReportSchema.parse(await request.json());
    const result = await reportPost(postId, input, principal);

    return successResponse(result, "Report submitted", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
