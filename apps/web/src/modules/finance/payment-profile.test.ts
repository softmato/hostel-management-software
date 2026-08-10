/**
 * Hostel payment profile — Block 1 item 1.4 and Block 6 item 6.1 of
 * docs/FINANCE_IMPLEMENTATION_PLAN.md (target §4.1).
 *
 * What must hold is that `tier` can never disagree with the gateway
 * configuration it describes, because a hostel shown as Tier 1 with no working
 * gateway sends residents to a dead payment screen. Item 6.1 replaced the single
 * `gatewayProvider` column with an array, so the same property is now asserted
 * over a hostel that runs two providers at once.
 */
import { describe, expect, it } from "vitest";

import {
  enabledGateways,
  findGateway,
  type GatewayConfig,
  isGatewayEligible,
  isPaymentProfileUsable,
  resolvePaymentTier,
} from "@hostel/db/models/HostelPaymentProfile";

const enabledAt = new Date("2026-08-01T00:00:00.000Z");

const esewa: GatewayConfig = {
  accountKind: "MERCHANT",
  enabledAt,
  merchantCode: "EPAYTEST",
  mode: "SANDBOX",
  provider: "ESEWA",
};

describe("resolvePaymentTier", () => {
  it("is TIER_1 when any gateway is enabled", () => {
    expect(resolvePaymentTier({ gateways: [esewa] })).toBe("TIER_1");
  });

  it.each([
    ["a configured but never enabled gateway", [{ ...esewa, enabledAt: null }]],
    ["no gateways at all", []],
  ])("is TIER_0 for %s", (_label, gateways) => {
    expect(resolvePaymentTier({ gateways })).toBe("TIER_0");
  });

  it("is TIER_0 for an empty profile and for no profile", () => {
    expect(resolvePaymentTier({})).toBe("TIER_0");
    expect(resolvePaymentTier(null)).toBe("TIER_0");
  });

  /**
   * The Block 6 rollback (§9): clearing `enabledAt` drops the hostel to Tier 0,
   * which stays fully functional. That only works while tier is derived — a
   * stored column would still read TIER_1.
   */
  it("falls back to TIER_0 the moment the last gateway is disabled", () => {
    const khalti: GatewayConfig = { ...esewa, provider: "KHALTI" };

    expect(resolvePaymentTier({ gateways: [esewa, khalti] })).toBe("TIER_1");
    // One of two switched off is still Tier 1 — the hostel can still be paid.
    expect(
      resolvePaymentTier({ gateways: [{ ...esewa, enabledAt: null }, khalti] }),
    ).toBe("TIER_1");
    expect(
      resolvePaymentTier({
        gateways: [
          { ...esewa, enabledAt: null },
          { ...khalti, enabledAt: null },
        ],
      }),
    ).toBe("TIER_0");
  });
});

describe("gateway entries", () => {
  it("finds one provider without disturbing the other", () => {
    const khalti: GatewayConfig = { ...esewa, merchantCode: null, provider: "KHALTI" };
    const profile = { gateways: [esewa, khalti] };

    expect(findGateway(profile, "ESEWA")?.merchantCode).toBe("EPAYTEST");
    expect(findGateway(profile, "KHALTI")?.merchantCode).toBeNull();
    expect(findGateway(profile, "FONEPAY")).toBeNull();
  });

  it("lists only the enabled entries", () => {
    const profile = {
      gateways: [esewa, { ...esewa, enabledAt: null, provider: "KHALTI" as const }],
    };

    expect(enabledGateways(profile).map((entry) => entry.provider)).toEqual(["ESEWA"]);
  });

  /**
   * An entry can be marked enabled and still be unusable. Counting one as live
   * makes the pay screen claim the hostel can be paid while rendering nothing —
   * so eligibility is part of the filter rather than a check each caller
   * remembers to repeat.
   */
  it("excludes an enabled entry that could never take a payment", () => {
    expect(
      enabledGateways({
        gateways: [
          { ...esewa, accountKind: "PERSONAL", provider: "FONEPAY" },
          { ...esewa, merchantCode: null },
        ],
      }),
    ).toEqual([]);
  });

  /**
   * The rule that keeps a hostel's rent from silently bouncing: a personal
   * wallet caps at NPR 5,000 a day, so it can never be a checkout however
   * complete the rest of its configuration looks.
   */
  it("never treats a personal account as eligible", () => {
    expect(isGatewayEligible({ ...esewa, accountKind: "PERSONAL" })).toBe(false);
    expect(
      isGatewayEligible({
        accountKind: "PERSONAL",
        merchantCode: "MERCHANT123",
        provider: "FONEPAY",
      }),
    ).toBe(false);
  });

  it("requires a merchant code from everyone except Khalti", () => {
    expect(isGatewayEligible({ ...esewa, merchantCode: null })).toBe(false);
    expect(isGatewayEligible({ provider: "FONEPAY" })).toBe(false);
    // Khalti identifies its merchant by secret key alone.
    expect(isGatewayEligible({ provider: "KHALTI" })).toBe(true);
  });

  it("is not eligible when there is no entry at all", () => {
    expect(isGatewayEligible(null)).toBe(false);
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

  /**
   * A hostel that takes only online payments has no manual destination at all,
   * and its pay screen must not claim it is unconfigured — the resident would
   * be told to contact a hostel that can already be paid in one tap.
   */
  it("accepts a profile whose only destination is a live gateway", () => {
    expect(isPaymentProfileUsable({ gateways: [esewa] })).toBe(true);
    expect(isPaymentProfileUsable({ gateways: [{ ...esewa, enabledAt: null }] })).toBe(
      false,
    );
  });
});
