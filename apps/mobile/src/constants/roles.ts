/**
 * Role → route group. Mirrors `packages/shared/src/types/roles.ts`.
 *
 * There is no `SERVICE_PROVIDER` role: a provider is a `PUBLIC` account with an
 * APPROVED `ServiceProvider` record behind it (PHASES.md §6.1, superseded note).
 * So the provider surface is decided from `/auth/me`'s provider flag, not from
 * `role` — which is why `resolveHome` takes the whole account, not just a role.
 */

import type { RoleAccentKey } from "@/constants/theme";

export const ROLE = {
  COOK: "COOK",
  GUARDIAN: "GUARDIAN",
  HOSTEL_ADMIN: "HOSTEL_ADMIN",
  PLATFORM_MODERATOR: "PLATFORM_MODERATOR",
  PUBLIC: "PUBLIC",
  RESIDENT: "RESIDENT",
  SUPERADMIN: "SUPERADMIN",
  WARDEN: "WARDEN",
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

/** Every route group the boot gate can land on. */
export type HomeRoute =
  | "/(admin)"
  | "/(auth)/login"
  | "/(cook)"
  | "/(guardian)"
  | "/(provider)"
  | "/(public)"
  | "/(resident)"
  | "/activate";

export type AccountShape = {
  /** True once the account has an APPROVED ServiceProvider record. */
  isApprovedProvider?: boolean;
  /** False for a RESIDENT account that has not yet redeemed its QR code. */
  isResidentActivated?: boolean;
  role: Role;
};

/**
 * The single decision the splash gate makes. Pure and synchronous on purpose —
 * it runs before the first frame, from a cached account, with no network.
 *
 * **Signed out goes to the public app, not to login.** The mobile app is the
 * website: someone who has not signed in can still browse hostels, compare them
 * and send an inquiry, exactly as they can on the web. Login is a destination
 * reached from a button, not a wall in front of the product — a hostel-hunting
 * student has no account yet and nothing to sign in with, and a login form is
 * the fastest way to lose them.
 *
 * The visible difference between signed-out and signed-in is what sits at the
 * bottom of the screen: a Login call to action, or that role's tabs.
 */
export function resolveHome(account: AccountShape | null): HomeRoute {
  if (!account) {
    return "/(public)";
  }

  switch (account.role) {
    case ROLE.RESIDENT:
      // An invited-but-unactivated resident has no dashboard to show yet.
      return account.isResidentActivated === false ? "/activate" : "/(resident)";
    case ROLE.GUARDIAN:
      return "/(guardian)";
    case ROLE.COOK:
      return "/(cook)";
    case ROLE.HOSTEL_ADMIN:
    case ROLE.WARDEN:
      return "/(admin)";
    case ROLE.SUPERADMIN:
    case ROLE.PLATFORM_MODERATOR:
      // Platform administration is web-only by design; staff get the public app.
      return "/(public)";
    case ROLE.PUBLIC:
      return account.isApprovedProvider ? "/(provider)" : "/(public)";
    default:
      return "/(public)";
  }
}

export function accentForAccount(account: AccountShape | null): RoleAccentKey {
  if (!account) return "PUBLIC";

  switch (account.role) {
    case ROLE.RESIDENT:
      return "RESIDENT";
    case ROLE.GUARDIAN:
      return "GUARDIAN";
    case ROLE.COOK:
      return "COOK";
    case ROLE.HOSTEL_ADMIN:
    case ROLE.WARDEN:
      return "ADMIN";
    case ROLE.SUPERADMIN:
    case ROLE.PLATFORM_MODERATOR:
      return "PLATFORM";
    case ROLE.PUBLIC:
      return account.isApprovedProvider ? "PROVIDER" : "PUBLIC";
    default:
      return "PUBLIC";
  }
}

export function readableRole(role: Role): string {
  switch (role) {
    case ROLE.HOSTEL_ADMIN:
      return "Hostel admin";
    case ROLE.PLATFORM_MODERATOR:
      return "Moderator";
    case ROLE.SUPERADMIN:
      return "Platform owner";
    default:
      return role.charAt(0) + role.slice(1).toLowerCase();
  }
}
