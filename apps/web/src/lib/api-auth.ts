import { Types } from "mongoose";
import type { NextRequest } from "next/server";

import { ACCESS_TOKEN_COOKIE, getBearerToken, verifyAccessToken } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { HOSTEL_STAFF_ROLES, PLATFORM_ROLES, assertAllowedRole } from "@/lib/permissions";
import { assertHostelAccess } from "@/lib/tenant";
import { Role } from "@/lib/roles";
import { grantingPermissionKeys } from "@/lib/warden-capability";
import { HostelMemberModel } from "@hostel/db/models/HostelMember";
import { isTemporaryCredentialActive } from "@/modules/auth/temporary-credential.service";
import type { WardenPermissionKey } from "@/modules/wardens/warden.validation";

export type ApiPrincipal = {
  hostelIds: string[];
  role: Role;
  sessionId?: string;
  /**
   * Set when the caller signed in with a temporary credential instead of the
   * account's own password. The identity is otherwise identical — same user,
   * same role, same hostels — so anything that must stay with the real owner
   * gates on this via {@link assertPrimaryCredentialPrincipal}.
   */
  temporaryCredentialId?: string;
  userId: string;
};

export class ApiAuthError extends Error {
  constructor(
    message: string,
    public errorCode = "UNAUTHENTICATED",
    public status = 401,
  ) {
    super(message);
  }
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.values(Role).includes(value as Role);
}

function cookieAccessToken(request: NextRequest) {
  return request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}

export async function loadApiPrincipal(request: NextRequest) {
  const accessToken =
    getBearerToken(request.headers.get("authorization")) ?? cookieAccessToken(request);

  if (!accessToken) {
    return null;
  }

  try {
    const payload = await verifyAccessToken(accessToken);

    if (!payload.sub || !isRole(payload.role)) {
      return null;
    }

    const temporaryCredentialId =
      typeof payload.temporaryCredentialId === "string"
        ? payload.temporaryCredentialId
        : undefined;

    /*
     * Revocation has to bite now, not at the next token refresh: the whole
     * point of "revoke" is that the person you handed the login to loses it
     * while you watch. Costs one indexed lookup, and only on the rare requests
     * that carry a temporary token — an ordinary session never reaches here.
     */
    if (
      temporaryCredentialId &&
      !(await isTemporaryCredentialActive(temporaryCredentialId))
    ) {
      return null;
    }

    return {
      hostelIds: Array.isArray(payload.hostelIds)
        ? payload.hostelIds.map((hostelId) => String(hostelId))
        : [],
      role: payload.role,
      sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
      temporaryCredentialId,
      userId: payload.sub,
    } satisfies ApiPrincipal;
  } catch {
    return null;
  }
}

/**
 * Refuses a caller who is signed in with a temporary credential.
 *
 * Guards the actions that must stay with whoever owns the account rather than
 * whoever is currently holding a borrowed login: minting or revoking temporary
 * credentials (otherwise a borrower could issue themselves a fresh one and
 * outlive the expiry date), and changing the account password (otherwise a
 * borrower could lock the owner out of their own account).
 */
export function assertPrimaryCredentialPrincipal(principal: ApiPrincipal) {
  if (principal.temporaryCredentialId) {
    throw new ApiAuthError(
      "Sign in with your own password to manage account access.",
      "TEMPORARY_CREDENTIAL_FORBIDDEN",
      403,
    );
  }
}

export async function requireApiPrincipal(request: NextRequest) {
  const principal = await loadApiPrincipal(request);

  if (!principal) {
    throw new ApiAuthError("Authentication is required.");
  }

  return principal;
}

export function assertApiRoles(principal: ApiPrincipal, roles: Role[]) {
  try {
    assertAllowedRole(principal, roles);
  } catch {
    throw new ApiAuthError(
      "This role is not allowed to perform this action.",
      "FORBIDDEN",
      403,
    );
  }
}

/**
 * Grants the platform portal to both SUPERADMIN and PLATFORM_MODERATOR — the
 * "acting superadmin" role, which sees and moderates everything a superadmin
 * does. The one thing it must not do is create or revoke other platform admins;
 * that is gated separately by {@link requireSuperadminPrincipal}.
 *
 * Matches the routing layer, which already lets PLATFORM_MODERATOR reach
 * /platform (see PLATFORM_ROLES and protectedRouteRules).
 */
export async function requirePlatformPrincipal(request: NextRequest) {
  const principal = await requireApiPrincipal(request);

  assertApiRoles(principal, PLATFORM_ROLES);

  return principal;
}

/**
 * Stricter than {@link requirePlatformPrincipal}: only a full SUPERADMIN passes.
 * Used for privilege management, so an acting superadmin cannot escalate itself
 * or mint further admins.
 */
export async function requireSuperadminPrincipal(request: NextRequest) {
  const principal = await requireApiPrincipal(request);

  assertApiRoles(principal, [Role.SUPERADMIN]);

  return principal;
}

export async function requireHostelStaffPrincipal(request: NextRequest) {
  const principal = await requireApiPrincipal(request);

  assertApiRoles(principal, HOSTEL_STAFF_ROLES);

  return principal;
}

/**
 * Hostel-staff gate that also enforces a warden's per-capability flags
 * (`HostelMember.permissions`, set from Warden Management).
 *
 * HOSTEL_ADMIN holds every capability implicitly and passes unchanged. For a
 * WARDEN, the returned principal's `hostelIds` is **narrowed** to just those
 * hostels where the flag is granted — so every downstream service, which
 * already scopes its queries by `principal.hostelIds`, is restricted without
 * needing to know capabilities exist. No grant anywhere → 403.
 *
 * Permissions are read per request rather than carried in the JWT, so revoking
 * a capability takes effect immediately instead of at the next token refresh.
 */
export async function requireHostelCapability(
  request: NextRequest,
  capability: WardenPermissionKey,
) {
  const principal = await requireHostelStaffPrincipal(request);

  if (principal.role !== Role.WARDEN) {
    return principal;
  }

  await connectToDatabase();

  const memberships = await HostelMemberModel.find({
    hostelId: { $in: principal.hostelIds.filter((id) => Types.ObjectId.isValid(id)) },
    isDeleted: { $ne: true },
    // Mongo matches a scalar against array membership; `$in` widens that to the
    // deprecated key a row may still be carrying.
    permissions: { $in: grantingPermissionKeys(capability) },
    status: "ACTIVE",
    userId: principal.userId,
  })
    .select("hostelId")
    .lean<{ hostelId: Types.ObjectId }[]>();

  const allowedHostelIds = memberships.map((member) => member.hostelId.toString());

  if (allowedHostelIds.length === 0) {
    throw new ApiAuthError(
      "Your warden account does not have permission for this action.",
      "CAPABILITY_DENIED",
      403,
    );
  }

  return { ...principal, hostelIds: allowedHostelIds } satisfies ApiPrincipal;
}

/**
 * Stricter than {@link requireHostelStaffPrincipal}: only HOSTEL_ADMIN may pass.
 * Wardens are hostel staff but cannot manage other wardens (PHASES.md §2 —
 * "Warden Management (HOSTEL_ADMIN only)").
 */
export async function requireHostelAdminPrincipal(request: NextRequest) {
  const principal = await requireApiPrincipal(request);

  assertApiRoles(principal, [Role.HOSTEL_ADMIN]);

  return principal;
}

export function assertHostelScopedApiAccess(principal: ApiPrincipal, hostelId: string) {
  try {
    assertHostelAccess(principal, hostelId);
  } catch {
    // 404, not 403 — see TenantAccessError in lib/tenant.ts.
    throw new ApiAuthError("Not found.", "NOT_FOUND", 404);
  }
}

export async function requireHostelScopedPrincipal(
  request: NextRequest,
  hostelId: string,
) {
  const principal = await requireApiPrincipal(request);

  assertApiRoles(principal, [Role.SUPERADMIN, ...HOSTEL_STAFF_ROLES]);
  assertHostelScopedApiAccess(principal, hostelId);

  return principal;
}

export async function requireResidentPrincipal(request: NextRequest) {
  const principal = await requireApiPrincipal(request);

  assertApiRoles(principal, [Role.RESIDENT]);

  return principal;
}

export async function requireGuardianPrincipal(request: NextRequest) {
  const principal = await requireApiPrincipal(request);

  assertApiRoles(principal, [Role.GUARDIAN]);

  return principal;
}
