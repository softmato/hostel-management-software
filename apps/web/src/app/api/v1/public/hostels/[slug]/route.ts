import type { NextRequest } from "next/server";

import {
  PUBLIC_CACHE,
  handleRouteError,
  successResponse,
} from "@/lib/api-response";
import { getPublicHostelBySlug } from "@/modules/hostels/hostel.service";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { slug } = await context.params;
    const result = await getPublicHostelBySlug(slug);

    return successResponse(result, "Public hostel loaded", PUBLIC_CACHE);
  } catch (error) {
    return handleRouteError(error);
  }
}
