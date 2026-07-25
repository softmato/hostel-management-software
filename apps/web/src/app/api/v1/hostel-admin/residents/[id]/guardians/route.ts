import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { requireHostelCapability } from "@/lib/api-auth";
import { addGuardian } from "@/modules/residents/resident.service";
import { guardianCreateSchema } from "@/modules/residents/resident.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "registerResidents");
    const { id } = await context.params;
    const input = guardianCreateSchema.parse(await request.json());
    const result = await addGuardian(id, input, principal);

    return successResponse(result, "Guardian added", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
