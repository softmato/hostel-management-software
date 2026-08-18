/**
 * The eSewa relay's hand-off builder.
 *
 * The page this feeds is reachable **without a session** — a phone's browser has
 * none — so most of what follows is about what it refuses: a settled intent it
 * would otherwise let somebody pay twice, an expired one, a reference that does
 * not exist, and a redirect provider that must never be put behind a browser.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const residentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b1");
const invoiceId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c1");
const intentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d1");

const mocks = vi.hoisted(() => ({
  createIntent: vi.fn(),
  credentials: vi.fn(),
  intentFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/site", () => ({ siteUrl: () => "https://softmato.test" }));
vi.mock("@/modules/finance/gateway/secret-store", () => ({
  getGatewayCredentials: mocks.credentials,
}));
vi.mock("@/modules/finance/gateway/registry", () => ({
  getProvider: () => ({ createIntent: mocks.createIntent, name: "ESEWA" }),
}));
vi.mock("@hostel/db/models/PaymentIntent", () => ({
  PaymentIntentModel: { findOne: mocks.intentFindOne },
}));

import {
  buildFormPostHandoff,
  HandoffError,
} from "@/modules/finance/gateway/handoff.service";

function lean<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function intentRecord(overrides: Record<string, unknown> = {}) {
  return {
    _id: intentId,
    amount: 8500,
    attempt: 2,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    hostelId,
    invoiceId,
    mode: "LIVE",
    provider: "ESEWA",
    reference: "EDU-0001-F-2",
    residentId,
    status: "CREATED",
    ...overrides,
  };
}

const formPostIntent = {
  expiresAt: new Date(),
  handoff: {
    fields: {
      amount: "8500",
      total_amount: "8500",
      transaction_uuid: "EDU-0001-F-2",
      signature: "deadbeef=",
    },
    kind: "FORM_POST",
    url: "https://rc-epay.esewa.com.np/api/epay/main/v2/form",
  },
  providerRef: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.intentFindOne.mockReturnValue(lean(intentRecord()));
  mocks.credentials.mockResolvedValue({
    merchantCode: "EPAYTEST",
    sandbox: false,
    secret: "shhh",
  });
  mocks.createIntent.mockResolvedValue(formPostIntent);
});

describe("buildFormPostHandoff", () => {
  it("returns the signed fields and the provider's form URL", async () => {
    const handoff = await buildFormPostHandoff("EDU-0001-F-2");

    expect(handoff.url).toBe(formPostIntent.handoff.url);
    expect(handoff.fields.signature).toBe("deadbeef=");
    expect(handoff.amount).toBe(8500);
  });

  it("rebuilds against the stored reference and attempt, not a fresh count", async () => {
    // Recounting attempts here would produce a *different* reference — and a
    // payment carrying a reference no intent holds is an orphan somebody has to
    // match to a person by hand.
    await buildFormPostHandoff("EDU-0001-F-2");

    expect(mocks.createIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 8500,
        attempt: 2,
        reference: "EDU-0001-F-2",
        returnUrl: "https://softmato.test/resident/payments/checkout/EDU-0001-F-2",
      }),
    );
  });

  it("preserves field order, which is what eSewa's signature covers", async () => {
    // The signature is positional against `signed_field_names`. Anything that
    // normalises key order produces a signature error mentioning nothing about
    // ordering, which is a very long afternoon.
    const handoff = await buildFormPostHandoff("EDU-0001-F-2");

    expect(Object.keys(handoff.fields)).toEqual(
      Object.keys(formPostIntent.handoff.fields),
    );
  });

  it("never re-presents a settled intent", async () => {
    // The failure that costs real money: the resident pays a second time for an
    // invoice that is already closed, and the hostel owes a refund.
    mocks.intentFindOne.mockReturnValue(lean(intentRecord({ status: "SUCCEEDED" })));

    await expect(buildFormPostHandoff("EDU-0001-F-2")).rejects.toMatchObject({
      reason: "NOT_PAYABLE",
    });
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });

  it("refuses a failed or expired-status intent so a fresh attempt is counted", async () => {
    for (const status of ["FAILED", "EXPIRED", "PENDING"]) {
      mocks.intentFindOne.mockReturnValue(lean(intentRecord({ status })));

      await expect(buildFormPostHandoff("EDU-0001-F-2")).rejects.toBeInstanceOf(
        HandoffError,
      );
    }
  });

  it("refuses an intent past its expiry", async () => {
    mocks.intentFindOne.mockReturnValue(
      lean(intentRecord({ expiresAt: new Date(Date.now() - 1000) })),
    );

    await expect(buildFormPostHandoff("EDU-0001-F-2")).rejects.toMatchObject({
      reason: "EXPIRED",
    });
  });

  it("answers an unknown reference the same way as an out-of-scope one", async () => {
    mocks.intentFindOne.mockReturnValue(lean(null));

    await expect(buildFormPostHandoff("NOPE-1")).rejects.toMatchObject({
      reason: "NOT_FOUND",
    });
  });

  it("refuses a REDIRECT provider rather than wrapping it in a browser", async () => {
    /*
     * Khalti's launch URL is a URL, and the app opens it directly so the
     * wallet's own app can claim the domain. Relaying it would put a browser
     * between the resident and an app that already holds their session, their
     * balance and their biometric unlock.
     */
    mocks.createIntent.mockResolvedValue({
      expiresAt: new Date(),
      handoff: { kind: "REDIRECT", url: "https://pay.khalti.com/x" },
      providerRef: "abc",
    });

    await expect(buildFormPostHandoff("EDU-0001-F-2")).rejects.toMatchObject({
      reason: "NOT_FORM_POST",
    });
  });

  it("passes the sandbox flag through so the page can say so", async () => {
    // A test merchant that looks like a live one is how somebody believes they
    // have paid their rent.
    mocks.intentFindOne.mockReturnValue(lean(intentRecord({ mode: "SANDBOX" })));

    expect((await buildFormPostHandoff("EDU-0001-F-2")).sandbox).toBe(true);
  });

  it("reads one intent by reference and writes nothing", async () => {
    /*
     * Opening the relay page twice must not be two attempts. `createIntent`
     * here is the provider adapter's pure signer, not `createPaymentIntent` —
     * which counts attempts and inserts a row. The mocked model exposes only
     * `findOne`, so any write would throw rather than pass quietly.
     */
    await buildFormPostHandoff("EDU-0001-F-2");
    await buildFormPostHandoff("EDU-0001-F-2");

    expect(mocks.intentFindOne).toHaveBeenCalledTimes(2);
    expect(mocks.intentFindOne).toHaveBeenCalledWith({ reference: "EDU-0001-F-2" });
  });
});
