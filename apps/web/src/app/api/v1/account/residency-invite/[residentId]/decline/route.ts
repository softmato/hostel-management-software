import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { declineResidencyInvite } from "@/modules/residents/residency-invite.service";

export const runtime = "nodejs";

/** "This is not me" — stops the question and tells the hostel to check the email. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ residentId: string }> },
) {
  try {
    const principal = await requireApiPrincipal(request);
    const { residentId } = await context.params;

    return successResponse(await declineResidencyInvite(principal, residentId), "Noted");
  } catch (error) {
    return handleRouteError(error);
  }
}
