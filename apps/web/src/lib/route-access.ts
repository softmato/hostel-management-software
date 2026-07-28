import { Role } from "@/lib/roles";

export type ProtectedRouteRule = {
  prefix: string;
  roles: Role[];
};

export const protectedRouteRules: ProtectedRouteRule[] = [
  {
    prefix: "/platform",
    roles: [Role.SUPERADMIN, Role.PLATFORM_MODERATOR],
  },
  {
    prefix: "/hostel-admin",
    roles: [Role.HOSTEL_ADMIN, Role.WARDEN],
  },
  {
    prefix: "/resident",
    roles: [Role.RESIDENT],
  },
  {
    prefix: "/guardian",
    roles: [Role.GUARDIAN],
  },
];

export const roleLandingPath: Record<Role, string> = {
  [Role.SUPERADMIN]: "/platform/dashboard",
  [Role.PLATFORM_MODERATOR]: "/platform/dashboard",
  [Role.HOSTEL_ADMIN]: "/hostel-admin/dashboard",
  [Role.WARDEN]: "/hostel-admin/dashboard",
  [Role.COOK]: "/",
  [Role.RESIDENT]: "/resident/dashboard",
  [Role.GUARDIAN]: "/guardian/dashboard",
  [Role.PUBLIC]: "/",
};

export const roleAllowedNextPrefixes: Partial<Record<Role, string[]>> = {
  [Role.SUPERADMIN]: ["/platform"],
  [Role.PLATFORM_MODERATOR]: ["/platform"],
  [Role.HOSTEL_ADMIN]: ["/hostel-admin"],
  [Role.WARDEN]: ["/hostel-admin"],
  [Role.RESIDENT]: ["/resident"],
  [Role.GUARDIAN]: ["/guardian"],
};

export function pathMatchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Tenant-scoped hostel workspace: `/{hostel-slug}/admin/...`. */
const HOSTEL_WORKSPACE_PATTERN = /^\/[^/]+\/admin(\/|$)/;

export function isHostelWorkspacePath(pathname: string) {
  return HOSTEL_WORKSPACE_PATTERN.test(pathname);
}

export function protectedRouteRuleForPath(pathname: string) {
  if (isHostelWorkspacePath(pathname)) {
    return protectedRouteRules.find((rule) => rule.prefix === "/hostel-admin");
  }

  return protectedRouteRules.find((rule) => pathMatchesPrefix(pathname, rule.prefix));
}

export function landingPathForRole(role: Role | string) {
  return roleLandingPath[role as Role];
}

export function dashboardHrefForRole(role: Role) {
  return landingPathForRole(role) ?? "/";
}

export function isSafeLocalPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//");
}

export function isAllowedNextPath(role: Role, value: string) {
  if (
    (role === Role.HOSTEL_ADMIN || role === Role.WARDEN) &&
    isHostelWorkspacePath(value)
  ) {
    return true;
  }

  const allowedPrefixes = roleAllowedNextPrefixes[role] ?? [];

  return allowedPrefixes.some((prefix) => pathMatchesPrefix(value, prefix));
}

export function destinationForRole(role: Role, requestedNext?: string | null) {
  if (
    requestedNext &&
    isSafeLocalPath(requestedNext) &&
    isAllowedNextPath(role, requestedNext)
  ) {
    return requestedNext;
  }

  return landingPathForRole(role) ?? "/";
}
