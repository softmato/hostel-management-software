import { Role } from "@/lib/roles";

export type TenantPrincipal = {
  hostelIds?: string[];
  role: Role;
  userId: string;
};

/**
 * A cross-tenant miss is reported as **404, not 403** (RULES.md §3).
 *
 * A 403 confirms the resource exists in some other hostel, which is exactly
 * what an attacker walking `/api/v1/residents/<objectid>` wants to learn. From
 * outside the tenant, "you may not see this" and "this does not exist" must be
 * indistinguishable — same status, same errorCode, same message as a genuine
 * miss.
 */
export class TenantAccessError extends Error {
  status = 404;
  errorCode = "NOT_FOUND";
}

export function canAccessHostel(principal: TenantPrincipal, hostelId: string) {
  if (principal.role === Role.SUPERADMIN) {
    return true;
  }

  return Boolean(principal.hostelIds?.includes(hostelId));
}

export function assertHostelAccess(principal: TenantPrincipal, hostelId: string) {
  if (!canAccessHostel(principal, hostelId)) {
    throw new TenantAccessError("Not found.");
  }
}

export function hostelScopedFilter(
  principal: TenantPrincipal,
  requestedHostelId?: string,
) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);
    return { hostelId: requestedHostelId };
  }

  if (principal.role === Role.SUPERADMIN) {
    return {};
  }

  return { hostelId: { $in: principal.hostelIds ?? [] } };
}
