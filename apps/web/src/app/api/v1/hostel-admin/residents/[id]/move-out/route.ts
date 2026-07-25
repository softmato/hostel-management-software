import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import {
  createMoveOutChecklist,
  getMoveOutChecklist,
} from "@/modules/move-checklist/move-checklist.service";
import { moveOutChecklistSchema } from "@/modules/move-checklist/move-checklist.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "registerResidents");
    const { id } = await context.params;
    const hostelId = request.nextUrl.searchParams.get("hostelId") ?? undefined;
    const result = await getMoveOutChecklist(id, principal, hostelId);

    return successResponse(result, "Move-out checklist loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "registerResidents");
    const { id } = await context.params;
    const input = moveOutChecklistSchema.parse(await request.json());
    const result = await createMoveOutChecklist(id, input, principal);

    return successResponse(result, "Move-out checklist saved", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
