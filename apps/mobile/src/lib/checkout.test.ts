import { describe, expect, it } from "vitest";

import { isCheckoutFinished, planHandoff } from "@/lib/checkout";

describe("planHandoff", () => {
  it("opens a redirect handoff", () => {
    expect(planHandoff({ kind: "REDIRECT", url: "https://khalti.test/pay" })).toEqual({
      kind: "OPEN_URL",
      url: "https://khalti.test/pay",
    });
  });

  it("refuses a form POST instead of opening something that will fail", () => {
    // eSewa v2 signs its fields positionally, so they have to reach the
    // provider as a POST body. `expo-web-browser` can only open a URL, and a
    // resident finding that out *after* committing to pay is the bad outcome.
    const plan = planHandoff({
      fields: { signature: "abc", total_amount: "12000" },
      kind: "FORM_POST",
      url: "https://esewa.test/form",
    });

    expect(plan.kind).toBe("UNSUPPORTED");
  });

  it("hands a QR payload back to be rendered", () => {
    expect(planHandoff({ kind: "QR", payload: "fonepay://x" })).toEqual({
      kind: "SHOW_QR",
      payload: "fonepay://x",
    });
  });
});

describe("isCheckoutFinished", () => {
  const future = "2026-08-16T12:00:00.000Z";
  const now = new Date("2026-08-16T11:00:00.000Z");

  it("stops as soon as the ledger says settled", () => {
    expect(
      isCheckoutFinished({ expiresAt: future, settled: true, status: "CREATED" }, now),
    ).toBe(true);
  });

  it("keeps polling a live, unsettled attempt", () => {
    // `CREATED` means the provider has not been reached or has not agreed. It
    // is not evidence of anything, in either direction.
    expect(
      isCheckoutFinished({ expiresAt: future, settled: false, status: "CREATED" }, now),
    ).toBe(false);
  });

  it("stops on a terminal status", () => {
    for (const status of ["CANCELLED", "EXPIRED", "FAILED"]) {
      expect(isCheckoutFinished({ expiresAt: future, settled: false, status }, now)).toBe(
        true,
      );
    }
  });

  it("stops once the intent has expired, whatever its status says", () => {
    // Otherwise a screen left open polls a dead reference until the battery
    // gives out.
    expect(
      isCheckoutFinished(
        { expiresAt: "2026-08-16T10:00:00.000Z", settled: false, status: "CREATED" },
        now,
      ),
    ).toBe(true);
  });

  it("does not treat an unparseable expiry as expired", () => {
    expect(
      isCheckoutFinished({ expiresAt: "", settled: false, status: "CREATED" }, now),
    ).toBe(false);
  });
});
