import type { NextRequest } from "next/server";

import { requireHostelStaffPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { updateReferralReward } from "@/modules/referrals/referral.service";
import { referralRewardUpdateSchema } from "@/modules/referrals/referral.validation";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const principal = await requireHostelStaffPrincipal(request);
    const { id } = await context.params;
    const input = referralRewardUpdateSchema.parse(await request.json());
    const result = await updateReferralReward(id, input, principal);

    return successResponse(result, "Referral reward updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
