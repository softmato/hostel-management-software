import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { addMaintenanceComment } from "@/modules/maintenance/maintenance.service";
import { maintenanceCommentCreateSchema } from "@/modules/maintenance/maintenance.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "manageMaintenance");
    const { id } = await context.params;
    const input = maintenanceCommentCreateSchema.parse(await request.json());
    const result = await addMaintenanceComment(id, input, principal);

    return successResponse(result, "Maintenance comment added", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
