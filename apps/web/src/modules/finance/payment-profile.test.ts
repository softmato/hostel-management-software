/**
 * Hostel payment profile — Block 1 item 1.4 of
 * docs/FINANCE_IMPLEMENTATION_PLAN.md (target §4.1).
 *
 * Only the derivation is testable at this stage: the collection ships with Tier
 * 0 fields, and the gateway fields exist in the schema but nothing reads them
 * until Block 6. What must hold now is that `tier` can never disagree with the
 * gateway configuration it describes, because a hostel shown as Tier 1 with no
 * working gateway sends residents to a dead payment screen.
 */
import { describe, expect, it } from "vitest";

import {
  isPaymentProfileUsable,
  resolvePaymentTier,
} from "@hostel/db/models/HostelPaymentProfile";

const enabledAt = new Date("2026-08-01T00:00:00.000Z");

describe("resolvePaymentTier", () => {
  it("is TIER_1 only when a provider is set and the gateway is enabled", () => {
    expect(
      resolvePaymentTier({ gatewayEnabledAt: enabledAt, gatewayProvider: "FONEPAY" }),
    ).toBe("TIER_1");
  });

  // Each half alone is a half-configured gateway, which is Tier 0 behaviour.
  it.each([
    [
      "a provider with no enable date",
      { gatewayEnabledAt: null, gatewayProvider: "FONEPAY" },
    ],
    [
      "an enable date with no provider",
      { gatewayEnabledAt: enabledAt, gatewayProvider: null },
    ],
    ["neither", { gatewayEnabledAt: null, gatewayProvider: null }],
    ["an empty profile", {}],
  ])("is TIER_0 for %s", (_label, profile) => {
    expect(resolvePaymentTier(profile)).toBe("TIER_0");
  });

  it("is TIER_0 when no profile exists at all", () => {
    expect(resolvePaymentTier(null)).toBe("TIER_0");
  });

  /**
   * The Block 6 rollback (§9): clearing `gatewayEnabledAt` drops the hostel to
   * Tier 0, which stays fully functional. That only works while tier is derived
   * — a stored column would still read TIER_1.
   */
  it("falls back to TIER_0 the moment the gateway is disabled", () => {
    const profile = { gatewayEnabledAt: enabledAt, gatewayProvider: "FONEPAY" };

    expect(resolvePaymentTier(profile)).toBe("TIER_1");
    expect(resolvePaymentTier({ ...profile, gatewayEnabledAt: null })).toBe("TIER_0");
  });
});

describe("isPaymentProfileUsable", () => {
  it.each([
    ["a QR image", { staticQrAssetId: "64f0f0f0f0f0f0f0f0f0f0a1" }],
    ["an eSewa id", { esewaId: "9841000000" }],
    ["a Khalti id", { khaltiId: "9841000000" }],
    ["a bank account", { bankAccountNumber: "01234567890" }],
  ])("accepts a profile carrying %s", (_label, profile) => {
    expect(isPaymentProfileUsable(profile)).toBe(true);
  });

  // A profile with a display name and instructions but no destination is an
  // empty form. The pay screen must say so rather than render a blank card.
  it("rejects a profile with no payment destination", () => {
    expect(
      isPaymentProfileUsable({
        bankAccountNumber: "",
        esewaId: null,
        khaltiId: null,
        staticQrAssetId: null,
      }),
    ).toBe(false);
  });

  it("rejects a missing profile", () => {
    expect(isPaymentProfileUsable(null)).toBe(false);
  });
});
