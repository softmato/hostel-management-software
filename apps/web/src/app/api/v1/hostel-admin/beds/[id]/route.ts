import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { requireHostelCapability } from "@/lib/api-auth";
import { updateHostelAdminBed } from "@/modules/hostels/hostel-spatial.service";
import { bedUpdateSchema } from "@/modules/hostels/hostel.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelCapability(request, "manageRooms");
    const { id } = await context.params;
    const input = bedUpdateSchema.parse(await request.json());
    const result = await updateHostelAdminBed(id, input, principal);

    return successResponse(result, "Bed updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
