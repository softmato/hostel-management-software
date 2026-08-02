import { describe, expect, it } from "vitest";

import { Role } from "@/lib/roles";
import {
  destinationForRole,
  isAllowedNextPath,
  isSafeLocalPath,
  protectedRouteRuleForPath,
} from "@/lib/route-access";

describe("route access", () => {
  it("maps protected portal prefixes to the expected roles", () => {
    expect(protectedRouteRuleForPath("/platform/dashboard")?.roles).toEqual([
      Role.SUPERADMIN,
      Role.PLATFORM_MODERATOR,
    ]);
    expect(protectedRouteRuleForPath("/hostel-admin/rooms")?.roles).toEqual([
      Role.HOSTEL_ADMIN,
      Role.WARDEN,
    ]);
    expect(protectedRouteRuleForPath("/resident/dashboard")?.roles).toEqual([
      Role.RESIDENT,
    ]);
    expect(protectedRouteRuleForPath("/guardian/dashboard")?.roles).toEqual([
      Role.GUARDIAN,
    ]);
  });

  it("keeps platform config, fee plans and settings superadmin-only", () => {
    // A moderator moderates content; configuration and billing are not theirs
    // (PHASES.md §5.1). The narrow rules must win over the broad /platform one.
    for (const path of [
      "/platform/config/site",
      "/platform/config",
      "/platform/fee-plans",
      "/platform/settings",
    ]) {
      expect(protectedRouteRuleForPath(path)?.roles).toEqual([Role.SUPERADMIN]);
    }

    // Everything a moderator *does* need stays reachable.
    for (const path of [
      "/platform/hostels",
      "/platform/service-providers",
      "/platform/reviews",
      "/platform/reports",
    ]) {
      expect(protectedRouteRuleForPath(path)?.roles).toContain(Role.PLATFORM_MODERATOR);
    }
  });

  it("does not treat same-prefix public paths as protected portal paths", () => {
    expect(protectedRouteRuleForPath("/platformer")).toBeUndefined();
    expect(protectedRouteRuleForPath("/resident-life")).toBeUndefined();
  });

  it("protects tenant-scoped hostel workspace paths with the hostel-admin roles", () => {
    expect(protectedRouteRuleForPath("/green-view-hostel/admin/payments")?.roles).toEqual(
      [Role.HOSTEL_ADMIN, Role.WARDEN],
    );
    expect(protectedRouteRuleForPath("/green-view-hostel/admin")?.roles).toEqual([
      Role.HOSTEL_ADMIN,
      Role.WARDEN,
    ]);
    // "admin" has to be the second segment — public pages are unaffected.
    expect(protectedRouteRuleForPath("/hostels/green-view-hostel")).toBeUndefined();
    expect(protectedRouteRuleForPath("/admin")).toBeUndefined();
  });

  it("allows staff next redirects into their own hostel workspace", () => {
    expect(
      isAllowedNextPath(Role.HOSTEL_ADMIN, "/green-view-hostel/admin/residents"),
    ).toBe(true);
    expect(isAllowedNextPath(Role.WARDEN, "/green-view-hostel/admin/rooms")).toBe(true);
    expect(isAllowedNextPath(Role.RESIDENT, "/green-view-hostel/admin/residents")).toBe(
      false,
    );
  });

  it("allows next redirects only inside the user's own portal", () => {
    expect(isAllowedNextPath(Role.HOSTEL_ADMIN, "/hostel-admin/residents")).toBe(true);
    expect(isAllowedNextPath(Role.HOSTEL_ADMIN, "/platform/dashboard")).toBe(false);
    expect(isAllowedNextPath(Role.RESIDENT, "/guardian/dashboard")).toBe(false);
  });

  it("falls back to the role landing page for unsafe or cross-role next paths", () => {
    expect(isSafeLocalPath("/resident/dashboard")).toBe(true);
    expect(isSafeLocalPath("//evil.example/login")).toBe(false);
    expect(destinationForRole(Role.RESIDENT, "//evil.example/resident/dashboard")).toBe(
      "/resident/dashboard",
    );
    expect(destinationForRole(Role.WARDEN, "/platform/dashboard")).toBe(
      "/hostel-admin/dashboard",
    );
  });
});
