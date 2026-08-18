import { describe, expect, it } from "vitest";

import { isCheckoutFinished, planHandoff, relayUrl } from "@/lib/checkout";

const BASE = "https://api.test";

describe("planHandoff", () => {
  it("opens a redirect handoff at the provider's own URL", () => {
    // Never through the relay: a REDIRECT is already a URL, and wrapping it
    // would put a browser between the resident and the wallet app that claims
    // that domain.
    expect(
      planHandoff({ kind: "REDIRECT", url: "https://khalti.test/pay" }, { baseUrl: BASE, reference: "EDU-1-1" }),
    ).toEqual({
      kind: "OPEN_URL",
      url: "https://khalti.test/pay",
    });
  });

  it("sends a form POST through the server's relay page", () => {
    // eSewa v2 signs its fields positionally, so they have to reach the
    // provider as a POST body — which a phone cannot do. `/pay/{reference}`
    // rebuilds the same signature server-side and serves a real form.
    const plan = planHandoff(
      {
        fields: { signature: "abc", total_amount: "12000" },
        kind: "FORM_POST",
        url: "https://esewa.test/form",
      },
      { baseUrl: BASE, reference: "EDU-0001-F-2" },
    );

    expect(plan).toEqual({
      kind: "OPEN_URL",
      url: relayUrl("EDU-0001-F-2", BASE),
    });
  });

  it("puts nothing but the reference in the relay URL", () => {
    // The signed fields are deliberately not carried: a signature in a URL is a
    // signature in a browser history, a server log and a referrer header.
    const plan = planHandoff(
      {
        fields: { signature: "abc", total_amount: "12000" },
        kind: "FORM_POST",
        url: "https://esewa.test/form",
      },
      { baseUrl: BASE, reference: "EDU-0001-F-2" },
    );

    expect(plan.kind === "OPEN_URL" && plan.url).not.toContain("abc");
    expect(plan.kind === "OPEN_URL" && plan.url).not.toContain("12000");
  });

  it("hands a QR payload back to be rendered", () => {
    expect(planHandoff({ kind: "QR", payload: "fonepay://x" }, { baseUrl: BASE, reference: "EDU-1-1" })).toEqual({
      kind: "SHOW_QR",
      payload: "fonepay://x",
    });
  });
});

describe("relayUrl", () => {
  it("escapes the reference rather than trusting its shape", () => {
    // References are built from a hostel-chosen prefix, so a stray `/` or `?`
    // would otherwise land the browser on a different route entirely.
    expect(relayUrl("EDU/0001?x", "https://api.test")).toBe(
      "https://api.test/pay/EDU%2F0001%3Fx",
    );
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
