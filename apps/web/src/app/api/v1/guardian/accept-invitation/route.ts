import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { acceptGuardianInvitation } from "@/modules/guardian/guardian-invite.service";
import { guardianInvitationAcceptSchema } from "@/modules/guardian/guardian.validation";

export const runtime = "nodejs";

/**
 * Public: the token in the emailed link is the only credential. It is
 * single-use — accepting clears it — and expires after 7 days.
 */
export async function POST(request: NextRequest) {
  try {
    const input = guardianInvitationAcceptSchema.parse(await request.json());
    const result = await acceptGuardianInvitation(input);

    return successResponse(result, "Guardian invitation accepted");
  } catch (error) {
    return handleRouteError(error);
  }
}
