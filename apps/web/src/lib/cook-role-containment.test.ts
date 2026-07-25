import { describe, expect, it } from "vitest";

import { assertAllowedRole, HOSTEL_STAFF_ROLES, PLATFORM_ROLES } from "@/lib/permissions";
import { Role } from "@/lib/roles";
import { roleAllowedNextPrefixes, roleLandingPath } from "@/lib/route-access";

/**
 * Cook credentials are a single shared kitchen login, handed to whoever is
 * cooking and realistically written down somewhere. These tests pin the blast
 * radius: if a resident ever learns the password, the worst they can reach is
 * the meal announcement endpoint — never staff or platform surfaces.
 *
 * If a future change grants COOK a new capability, one of these fails first.
 */
describe("COOK role containment", () => {
  const cook = { role: Role.COOK, userId: "64f0f0f0f0f0f0f0f0f0f0c1" };

  it("is not hostel staff", () => {
    expect(HOSTEL_STAFF_ROLES).not.toContain(Role.COOK);
    expect(() => assertAllowedRole(cook, HOSTEL_STAFF_ROLES)).toThrow();
  });

  it("is not a platform role", () => {
    expect(PLATFORM_ROLES).not.toContain(Role.COOK);
    expect(() => assertAllowedRole(cook, PLATFORM_ROLES)).toThrow();
  });

  it("cannot pass a resident or guardian gate", () => {
    expect(() => assertAllowedRole(cook, [Role.RESIDENT])).toThrow();
    expect(() => assertAllowedRole(cook, [Role.GUARDIAN])).toThrow();
  });

  it("has no portal to land in and no allowed redirect prefixes", () => {
    // A cook signing in on the web gets the public site, not a dashboard.
    expect(roleLandingPath[Role.COOK]).toBe("/");
    expect(roleAllowedNextPrefixes[Role.COOK]).toBeUndefined();
  });
});
