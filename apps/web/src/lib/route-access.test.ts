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

  it("guards the provider job list as signed-in-only", () => {
    // Provider is not a role — it is a PUBLIC account with an approved
    // ServiceProvider record, which the access token does not carry. `null` is
    // the strongest thing the edge can say, and it is the difference between a
    // guarded route and the nothing that was there before.
    expect(protectedRouteRuleForPath("/jobs")?.roles).toBeNull();
    expect(protectedRouteRuleForPath("/jobs/42")?.roles).toBeNull();
    // Same-prefix public paths are unaffected.
    expect(protectedRouteRuleForPath("/jobseekers")).toBeUndefined();
  });

  it("gives every role a portal it may enter and portals it may not", () => {
    /*
     * The table read as a whole, because the failure this catches is a role
     * nobody wrote a rule for. A COOK has no web portal — they work from the
     * app — so every guarded prefix must turn them away rather than fall
     * through, and the same holds for PUBLIC.
     */
    const portals = [
      "/platform/dashboard",
      "/hostel-admin/dashboard",
      "/resident/dashboard",
      "/guardian/dashboard",
    ];

    const allowed: Partial<Record<Role, string[]>> = {
      [Role.SUPERADMIN]: ["/platform/dashboard"],
      [Role.PLATFORM_MODERATOR]: ["/platform/dashboard"],
      [Role.HOSTEL_ADMIN]: ["/hostel-admin/dashboard"],
      [Role.WARDEN]: ["/hostel-admin/dashboard"],
      [Role.COOK]: [],
      [Role.RESIDENT]: ["/resident/dashboard"],
      [Role.GUARDIAN]: ["/guardian/dashboard"],
      [Role.PUBLIC]: [],
    };

    for (const role of Object.values(Role)) {
      for (const portal of portals) {
        const rule = protectedRouteRuleForPath(portal);

        expect(rule).toBeDefined();
        expect(rule?.roles?.includes(role) ?? false).toBe(
          (allowed[role] ?? []).includes(portal),
        );
      }
    }
  });

  it("returns every role to the public page they came from", () => {
    /*
     * The service-provider funnel and resident activation are public pages that
     * send a visitor to `/login?next=…` and expect them back. They belong to no
     * role's prefix list, so a prefix-only check dropped a PUBLIC account on
     * `/` and a hostel admin on their dashboard instead.
     */
    expect(destinationForRole(Role.PUBLIC, "/service-providers")).toBe(
      "/service-providers",
    );
    expect(destinationForRole(Role.HOSTEL_ADMIN, "/service-providers")).toBe(
      "/service-providers",
    );
    expect(destinationForRole(Role.PUBLIC, "/resident-activation")).toBe(
      "/resident-activation",
    );
    // Signed-in-only, not role-bound: an approved provider is a PUBLIC account.
    expect(destinationForRole(Role.PUBLIC, "/jobs")).toBe("/jobs");
    // A public `next` still cannot become a door into someone else's portal.
    expect(destinationForRole(Role.PUBLIC, "/platform/dashboard")).toBe("/");
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
