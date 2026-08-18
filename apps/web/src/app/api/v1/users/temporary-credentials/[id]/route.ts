import type { NextRequest } from "next/server";

import { assertPrimaryCredentialPrincipal, requireApiPrincipal } from "@/lib/api-auth";
import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import {
  revokeTemporaryCredential,
  TemporaryCredentialError,
} from "@/modules/auth/temporary-credential.service";

export const runtime = "nodejs";

/**
 * Revokes one temporary login and every session it opened. Scoped to the
 * caller's own account inside the service, so another account's id answers 404
 * exactly as a non-existent one does (RULES.md §3).
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const principal = await requireApiPrincipal(request);

    // Revoking is owner-only for the same reason issuing is: a borrower must
    // not be able to cull the credentials that would let the owner back in.
    assertPrimaryCredentialPrincipal(principal);

    const { id } = await context.params;

    return successResponse(
      await revokeTemporaryCredential(principal.userId, id),
      "Temporary login revoked",
    );
  } catch (error) {
    if (error instanceof TemporaryCredentialError) {
      return errorResponse(error.message, error.errorCode, error.status);
    }

    return handleRouteError(error);
  }
}
