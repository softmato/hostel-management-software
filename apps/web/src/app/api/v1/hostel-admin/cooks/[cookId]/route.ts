import type { NextRequest } from "next/server";

import { requireHostelCapability } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import {
  removeCookAccount,
  updateCookAccount,
} from "@/modules/food/cook-roster.service";
import { cookUpdateSchema } from "@/modules/food/cook.validation";

export const runtime = "nodejs";

type Params = { params: Promise<{ cookId: string }> };

/** Rename a cook, or issue a fresh first-time password with `rotate: true`. */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const principal = await requireHostelCapability(request, "manageFood");
    const { cookId } = await params;
    const input = cookUpdateSchema.parse(await request.json());
    const result = await updateCookAccount(cookId, input, principal);

    return successResponse(result, input.rotate ? "New password issued" : "Cook updated");
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Removes a cook for good. The account goes; the roster row stays, carrying the
 * name their past announcements and photos are attributed to from here on.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const principal = await requireHostelCapability(request, "manageFood");
    const { cookId } = await params;
    const hostelId = request.nextUrl.searchParams.get("hostelId") ?? undefined;
    const result = await removeCookAccount(cookId, principal, hostelId);

    return successResponse(result, "Cook removed");
  } catch (error) {
    return handleRouteError(error);
  }
}
