import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { payoutSchema, recordTeamPayout } from "@/modules/team/team-commission.service";

export const runtime = "nodejs";

/** Records a payout from one agent's wallet. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const { agentId } = await params;
    const input = payoutSchema.parse(await request.json());

    return successResponse(
      await recordTeamPayout(agentId, input, principal.userId),
      "Payout recorded",
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
