export enum Role {
  SUPERADMIN = "SUPERADMIN",
  PLATFORM_MODERATOR = "PLATFORM_MODERATOR",
  /**
   * A member of the platform's own field team, working out of `/team`.
   *
   * They register hostels on an owner's behalf and collect the first payment in
   * person, which is why a hostel they file is published immediately rather than
   * queueing for review: the data was gathered and checked by staff, so the
   * verification the public queue exists to perform has already happened.
   *
   * Deliberately *not* a platform admin. `PLATFORM_ROLES` gates the superadmin
   * portal and this role is absent from it — an agent can create a hostel and
   * take money for a plan, and can see nothing else about the platform.
   */
  PLATFORM_AGENT = "PLATFORM_AGENT",
  HOSTEL_ADMIN = "HOSTEL_ADMIN",
  WARDEN = "WARDEN",
  COOK = "COOK",
  RESIDENT = "RESIDENT",
  GUARDIAN = "GUARDIAN",
  PUBLIC = "PUBLIC",
}

export const ROLE_VALUES = Object.values(Role);

/**
 * Maps role values from the pre-docs codebase to the canonical
 * DATABASE.md roles. Used by the one-shot data migration script
 * (packages/db/src/migrate-roles.ts) — not by runtime auth logic.
 */
export const LEGACY_ROLE_MAP: Record<string, Role> = {
  PLATFORM_OWNER: Role.SUPERADMIN,
  HOSTEL_OWNER: Role.HOSTEL_ADMIN,
  PUBLIC_USER: Role.PUBLIC,
  SERVICE_PROVIDER: Role.PUBLIC,
};
