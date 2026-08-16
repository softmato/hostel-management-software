import { describe, expect, it } from "vitest";

import { ROLE, accentForAccount, resolveHome } from "@/constants/roles";

/**
 * These cases are the boot contract. Every one of them runs before the first
 * frame on a cold start, so a wrong answer here is a visible wrong screen —
 * which is precisely what the no-flash boot exists to prevent.
 */
describe("resolveHome", () => {
  it("sends a signed-out device to the public app, never to a login wall", () => {
    // The app is the website: browsing hostels needs no account, and a
    // hostel-hunting student has nothing to sign in with yet. Login is reached
    // from a button at the bottom of the public shell.
    expect(resolveHome(null)).toBe("/(public)");
  });

  it("sends an activated resident straight to the resident tabs", () => {
    expect(resolveHome({ isResidentActivated: true, role: ROLE.RESIDENT })).toBe(
      "/(resident)",
    );
  });

  it("sends an invited-but-unactivated resident to QR activation", () => {
    expect(resolveHome({ isResidentActivated: false, role: ROLE.RESIDENT })).toBe(
      "/activate",
    );
  });

  it("treats unknown activation as activated", () => {
    // A cold, offline start has no activation answer cached. Bouncing a
    // working resident to the QR scanner would be worse than showing a
    // dashboard that revalidation can correct a moment later.
    expect(resolveHome({ role: ROLE.RESIDENT })).toBe("/(resident)");
  });

  it("routes guardian, cook and warden to their own groups", () => {
    expect(resolveHome({ role: ROLE.GUARDIAN })).toBe("/(guardian)");
    expect(resolveHome({ role: ROLE.COOK })).toBe("/(cook)");
    expect(resolveHome({ role: ROLE.WARDEN })).toBe("/(admin)");
    expect(resolveHome({ role: ROLE.HOSTEL_ADMIN })).toBe("/(admin)");
  });

  it("gives platform staff the public app, not an admin surface", () => {
    // Platform administration is web-only by design (PHASES.md §6.1). A
    // superadmin on a phone is just a person browsing hostels.
    expect(resolveHome({ role: ROLE.SUPERADMIN })).toBe("/(public)");
    expect(resolveHome({ role: ROLE.PLATFORM_MODERATOR })).toBe("/(public)");
  });

  it("separates an approved service provider from an ordinary public account", () => {
    // There is no SERVICE_PROVIDER role — both of these are PUBLIC, and only
    // the approved-provider flag tells them apart.
    expect(resolveHome({ isApprovedProvider: true, role: ROLE.PUBLIC })).toBe(
      "/(provider)",
    );
    expect(resolveHome({ isApprovedProvider: false, role: ROLE.PUBLIC })).toBe("/(public)");
    expect(resolveHome({ role: ROLE.PUBLIC })).toBe("/(public)");
  });
});

describe("accentForAccount", () => {
  it("gives each audience its own chrome", () => {
    expect(accentForAccount(null)).toBe("PUBLIC");
    expect(accentForAccount({ role: ROLE.RESIDENT })).toBe("RESIDENT");
    expect(accentForAccount({ role: ROLE.GUARDIAN })).toBe("GUARDIAN");
    expect(accentForAccount({ role: ROLE.COOK })).toBe("COOK");
    expect(accentForAccount({ role: ROLE.WARDEN })).toBe("ADMIN");
    expect(accentForAccount({ isApprovedProvider: true, role: ROLE.PUBLIC })).toBe(
      "PROVIDER",
    );
  });
});
