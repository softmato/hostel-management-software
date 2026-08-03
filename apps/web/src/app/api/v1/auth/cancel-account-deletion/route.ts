import type { NextRequest } from "next/server";

import { handleRouteError, successResponse } from "@/lib/api-response";
import { rateLimitPublicForm } from "@/lib/rate-limit";
import { cancelAccountDeletionByToken } from "@/modules/users/account-deletion.service";
import { accountDeletionCancelSchema } from "@/modules/users/account-deletion.validation";

export const runtime = "nodejs";

/**
 * Cancel a pending deletion from the emailed link.
 *
 * Deliberately unauthenticated: the account is suspended, so the user *cannot*
 * log in to reach a settings page (ARCHITECTURE.md §13.1 wants the account
 * closed and cancellable at the same time). The signed, single-purpose token in
 * the link is the credential — it names one user, cannot be replayed as an
 * access token, and expires with the grace period it belongs to. It lives under
 * `/api/v1/auth/*`, which is the rate-limited surface (RULES.md §4).
 */
export async function POST(request: NextRequest) {
  try {
    // The token is unguessable, but the endpoint is unauthenticated, so it is
    // rate-limited like every other public auth form (RULES.md §4).
    const limited = rateLimitPublicForm(request, {
      limit: 10,
      namespace: "auth-cancel-account-deletion",
      windowMs: 15 * 60 * 1000,
    });

    if (limited) {
      return limited;
    }

    const { token } = accountDeletionCancelSchema.parse(await request.json());
    const result = await cancelAccountDeletionByToken(token);

    return successResponse(result, "Account deletion cancelled");
  } catch (error) {
    return handleRouteError(error);
  }
}
