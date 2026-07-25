import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { requireHostelCapability } from "@/lib/api-auth";
import {
  createHostelAdminRoom,
  listHostelAdminRooms,
} from "@/modules/hostels/hostel-spatial.service";
import {
  hostelScopedListQuerySchema,
  roomCreateSchema,
} from "@/modules/hostels/hostel.validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const principal = await requireHostelCapability(request, "manageRooms");
    const query = hostelScopedListQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const result = await listHostelAdminRooms(query, principal);

    return successResponse(result, "Rooms loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireHostelCapability(request, "manageRooms");
    const input = roomCreateSchema.parse(await request.json());
    const result = await createHostelAdminRoom(input, principal);

    return successResponse(result, "Room created", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
