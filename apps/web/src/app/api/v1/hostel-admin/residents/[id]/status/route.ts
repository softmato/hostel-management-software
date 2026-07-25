import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { requireHostelCapability } from "@/lib/api-auth";
import { updateResidentStatus } from "@/modules/residents/resident.service";
import { residentStatusSchema } from "@/modules/residents/resident.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "registerResidents");
    const { id } = await context.params;
    const input = residentStatusSchema.parse(await request.json());
    const result = await updateResidentStatus(id, input, principal);

    return successResponse(result, "Resident status updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
