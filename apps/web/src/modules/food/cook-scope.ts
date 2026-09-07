import type { ApiPrincipal } from "@/lib/api-auth";
import { assertHostelAccess } from "@/lib/tenant";
import { normalizeObjectId } from "@/modules/residents/resident-access";

/**
 * The error type and the hostel-scoping rule shared by every cook surface.
 *
 * These lived in `cook.service.ts` until the roster arrived. Both files need
 * them and `cook.service` needs the roster, so keeping them there would have
 * made the import cycle — this module is the bottom of that stack and imports
 * neither service.
 */
export class CookServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "COOK_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

/**
 * Which hostel an admin's cook action applies to.
 *
 * An admin of exactly one hostel need not say which; an admin of several must,
 * because guessing would hand a cook login to the wrong kitchen.
 */
export function resolveAdminHostelId(
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);
    return normalizeObjectId(requestedHostelId, "hostel id");
  }

  if (principal.hostelIds.length === 1) {
    return normalizeObjectId(principal.hostelIds[0], "hostel id");
  }

  throw new CookServiceError(
    "A hostelId is required for this hostel admin action.",
    "HOSTEL_SCOPE_REQUIRED",
    422,
  );
}
