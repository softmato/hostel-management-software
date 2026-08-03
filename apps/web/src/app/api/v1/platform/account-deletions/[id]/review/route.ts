import type { NextRequest } from "next/server";

import { assertApiRoles, requirePlatformPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { Role } from "@/lib/roles";
import { reviewAccountDeletionRequest } from "@/modules/users/account-deletion.service";
import { accountDeletionReviewSchema } from "@/modules/users/account-deletion.validation";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requirePlatformPrincipal(request);

    assertApiRoles(principal, [Role.SUPERADMIN]);

    const { id } = await params;
    const input = accountDeletionReviewSchema.parse(await request.json());
    const result = await reviewAccountDeletionRequest(id, input, principal);

    return successResponse(
      result,
      input.decision === "APPROVED"
        ? "Deletion approved — the account is closed and will be erased in 60 days"
        : "Deletion request declined",
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
