import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { requireHostelCapability } from "@/lib/api-auth";
import { updateHostelAdminRoom } from "@/modules/hostels/hostel-spatial.service";
import { roomUpdateSchema } from "@/modules/hostels/hostel.validation";

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
    const input = roomUpdateSchema.parse(await request.json());
    const result = await updateHostelAdminRoom(id, input, principal);

    return successResponse(result, "Room updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
