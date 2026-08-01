import type { NextRequest } from "next/server";

import { requireResidentPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import {
  createCommunityPost,
  listCommunityFeed,
} from "@/modules/community/community.service";
import {
  communityFeedQuerySchema,
  communityPostCreateSchema,
} from "@/modules/community/community.validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const principal = await requireResidentPrincipal(request);
    const query = communityFeedQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const result = await listCommunityFeed(query, principal);

    return successResponse(result, "Community feed loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireResidentPrincipal(request);
    const input = communityPostCreateSchema.parse(await request.json());
    const result = await createCommunityPost(input, principal);

    return successResponse(result, "Post published", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
