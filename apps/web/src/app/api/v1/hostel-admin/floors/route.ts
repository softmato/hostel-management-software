import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { requireHostelCapability } from "@/lib/api-auth";
import {
  createHostelAdminFloor,
  listHostelAdminFloors,
} from "@/modules/hostels/hostel-spatial.service";
import {
  floorCreateSchema,
  hostelScopedListQuerySchema,
} from "@/modules/hostels/hostel.validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const principal = await requireHostelCapability(request, "manageRooms");
    const query = hostelScopedListQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const result = await listHostelAdminFloors(query, principal);

    return successResponse(result, "Floors loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireHostelCapability(request, "manageRooms");
    const input = floorCreateSchema.parse(await request.json());
    const result = await createHostelAdminFloor(input, principal);

    return successResponse(result, "Floor created", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
