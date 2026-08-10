/**
 * Khalti ePayment v2 adapter — Block 6 item 6.5 of
 * docs/FINANCE_IMPLEMENTATION_PLAN.md.
 *
 * The paisa conversion carries most of the risk here: getting it wrong by the
 * factor of a hundred it invites either charges a resident a hundred times their
 * rent or a hundredth of it. It is asserted in both directions, at both call
 * sites. The rest is the status table, where the interesting entries are the ones
 * that look like successes and must not settle — a refunded `Completed`, and
 * anything Khalti adds after this was written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { khaltiProvider } from "./khalti.provider";
import type { GatewayCredentials } from "./provider.types";

const sandbox: GatewayCredentials = {
  merchantCode: "",
  provider: "KHALTI",
  sandbox: true,
  secret: "test_secret_key_abc123",
  webhookSecret: "test_secret_key_abc123",
};

const live: GatewayCredentials = { ...sandbox, sandbox: false };

const request = {
  amount: 12000,
  attempt: 1,
  callbackUrl: "https://softmato.test/api/v1/webhooks/khalti",
  credentials: sandbox,
  failureUrl: "https://softmato.test/resident/payments/checkout/EDU-0001-F-1?outcome=failed",
  invoiceId: "64f0f0f0f0f0f0f0f0f0f0c1",
  reference: "EDU-0001-F-1",
  referenceCode: "EDU-0001-F",
  returnUrl: "https://softmato.test/resident/payments/checkout/EDU-0001-F-1",
};

function respond(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

const initiated = {
  expires_in: 1800,
  payment_url: "https://test-pay.khalti.com/?pidx=bZQLD9wRVWo4CdESSfuSsB",
  pidx: "bZQLD9wRVWo4CdESSfuSsB",
};

beforeEach(() => {
  vi.stubGlobal("fetch", respond(initiated));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opening a checkout", () => {
  /** NPR 12,000 is 1200000 paisa. A factor of a hundred either way is a disaster. */
  it("sends the amount in paisa", async () => {
    const fetchMock = respond(initiated);

    vi.stubGlobal("fetch", fetchMock);

    await khaltiProvider.createIntent(request);

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toMatchObject({
      amount: 1200000,
    });
  });

  it("authenticates with Khalti's Key scheme, not Bearer", async () => {
    // A Bearer prefix returns a 401 that reads exactly like a wrong key.
    const fetchMock = respond(initiated);

    vi.stubGlobal("fetch", fetchMock);

    await khaltiProvider.createIntent(request);

    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe(
      "Key test_secret_key_abc123",
    );
  });

  it("uses the sandbox host for sandbox credentials and the live one otherwise", async () => {
    const fetchMock = respond(initiated);

    vi.stubGlobal("fetch", fetchMock);

    await khaltiProvider.createIntent(request);
    await khaltiProvider.createIntent({ ...request, credentials: live });

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://dev.khalti.com/api/v2/epayment/initiate/",
    );
    expect(fetchMock.mock.calls[1]![0]).toBe(
      "https://khalti.com/api/v2/epayment/initiate/",
    );
  });

  it("hands the browser a redirect, not a form", async () => {
    // Khalti has already signed the attempt on its side, so there is nothing
    // for the browser to carry.
    expect((await khaltiProvider.createIntent(request)).handoff).toEqual({
      kind: "REDIRECT",
      url: initiated.payment_url,
    });
  });

  it("stores the pidx, because verification is keyed by it", async () => {
    expect((await khaltiProvider.createIntent(request)).providerRef).toBe(initiated.pidx);
  });

  it("sends our per-attempt reference as the purchase order id", async () => {
    const fetchMock = respond(initiated);

    vi.stubGlobal("fetch", fetchMock);

    await khaltiProvider.createIntent(request);

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toMatchObject({
      purchase_order_id: "EDU-0001-F-1",
      website_url: "https://softmato.test",
    });
  });

  it("honours Khalti's own expiry window", async () => {
    const intent = await khaltiProvider.createIntent(request);
    const minutes = (intent.expiresAt.getTime() - Date.now()) / 60000;

    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThan(31);
  });

  /**
   * Khalti's own rejection for this is a 400 with an opaque body, which the
   * resident would see only after committing to pay.
   */
  it("refuses an amount below Khalti's minimum before asking", async () => {
    const fetchMock = respond(initiated);

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      khaltiProvider.createIntent({ ...request, amount: 5 }),
    ).rejects.toMatchObject({ errorCode: "AMOUNT_OUT_OF_BOUNDS" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a response with no payment link", async () => {
    vi.stubGlobal("fetch", respond({ pidx: "abc" }));

    await expect(khaltiProvider.createIntent(request)).rejects.toMatchObject({
      errorCode: "GATEWAY_UNREACHABLE",
    });
  });

  it("reports an unreachable Khalti rather than a failed payment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    await expect(khaltiProvider.createIntent(request)).rejects.toMatchObject({
      errorCode: "GATEWAY_UNREACHABLE",
    });
  });

  it("passes a 5xx through as unreachable, not as a rejection", async () => {
    vi.stubGlobal("fetch", respond({ detail: "boom" }, false, 503));

    await expect(khaltiProvider.createIntent(request)).rejects.toMatchObject({
      errorCode: "GATEWAY_UNREACHABLE",
    });
  });

  it("surfaces Khalti's own message on a 4xx", async () => {
    vi.stubGlobal("fetch", respond({ detail: "Invalid token." }, false, 401));

    await expect(khaltiProvider.createIntent(request)).rejects.toThrow(/Invalid token/);
  });
});

describe("the unsigned browser return", () => {
  /**
   * Khalti sends no signed server-to-server callback. Accepting its unsigned
   * redirect parameters would let a stranger make us call Khalti — harmless for
   * money, since `verify` is still the authority, but a free amplifier against
   * our own rate limit with the provider.
   */
  it("is never accepted as a callback", () => {
    expect(
      khaltiProvider.parseWebhook(
        JSON.stringify({
          pidx: "bZQLD9wRVWo4CdESSfuSsB",
          purchase_order_id: "EDU-0001-F-1",
          status: "Completed",
        }),
        {},
        sandbox,
      ),
    ).toBeNull();
  });
});

describe("asking Khalti what happened", () => {
  const attempt = {
    amount: 12000,
    providerTxnId: "bZQLD9wRVWo4CdESSfuSsB",
    reference: "EDU-0001-F-1",
  };

  it("looks up by pidx", async () => {
    const fetchMock = respond({ status: "Completed", total_amount: 1200000 });

    vi.stubGlobal("fetch", fetchMock);

    await khaltiProvider.verify(attempt, sandbox);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://dev.khalti.com/api/v2/epayment/lookup/",
    );
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      pidx: "bZQLD9wRVWo4CdESSfuSsB",
    });
  });

  /** The other half of the conversion, and the half that decides settlement. */
  it("converts paisa back to whole rupees", async () => {
    vi.stubGlobal("fetch", respond({ status: "Completed", total_amount: 1200000 }));

    expect((await khaltiProvider.verify(attempt, sandbox)).amount).toBe(12000);
  });

  it("returns Khalti's own amount, not the one we asked for", async () => {
    // The caller compares the two, so echoing ours back would make that check
    // tautological and let a mismatched charge settle.
    vi.stubGlobal("fetch", respond({ status: "Completed", total_amount: 100 }));

    expect((await khaltiProvider.verify(attempt, sandbox)).amount).toBe(1);
  });

  it("prefers the settled transaction id once there is one", async () => {
    vi.stubGlobal(
      "fetch",
      respond({ status: "Completed", total_amount: 1200000, transaction_id: "GFT0..." }),
    );

    expect((await khaltiProvider.verify(attempt, sandbox)).providerTxnId).toBe("GFT0...");
  });

  it("falls back to the pidx while there is not", async () => {
    // The ledger's idempotency key is built from this, so it can never be empty.
    vi.stubGlobal("fetch", respond({ status: "Pending", total_amount: 1200000 }));

    expect((await khaltiProvider.verify(attempt, sandbox)).providerTxnId).toBe(
      "bZQLD9wRVWo4CdESSfuSsB",
    );
  });

  it.each([
    ["Completed", false, "SUCCESS"],
    ["Pending", false, "PENDING"],
    ["Initiated", false, "PENDING"],
    ["Expired", false, "FAILED"],
    ["User canceled", false, "FAILED"],
    ["Refunded", false, "FAILED"],
    ["Partially Refunded", false, "FAILED"],
    ["Something New", false, "FAILED"],
  ])("maps %s to %s", async (khaltiStatus, refunded, expected) => {
    vi.stubGlobal(
      "fetch",
      respond({ refunded, status: khaltiStatus, total_amount: 1200000 }),
    );

    expect((await khaltiProvider.verify(attempt, sandbox)).status).toBe(expected);
  });

  /**
   * The one that looks like a success and is not: the money came back, so
   * crediting the invoice would leave the hostel short by exactly that amount.
   */
  it("does not settle a completed payment that was refunded", async () => {
    vi.stubGlobal(
      "fetch",
      respond({ refunded: true, status: "Completed", total_amount: 1200000 }),
    );

    expect((await khaltiProvider.verify(attempt, sandbox)).status).toBe("FAILED");
  });

  it("fails an attempt Khalti never opened, without asking", async () => {
    // No pidx means the checkout was never created, so there is nothing that
    // could have been paid.
    const fetchMock = respond({});

    vi.stubGlobal("fetch", fetchMock);

    expect(
      await khaltiProvider.verify({ ...attempt, providerTxnId: null }, sandbox),
    ).toMatchObject({ status: "FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unreachable Khalti rather than a failed payment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ETIMEDOUT")));

    await expect(khaltiProvider.verify(attempt, sandbox)).rejects.toMatchObject({
      errorCode: "GATEWAY_UNREACHABLE",
    });
  });

  it("does not hang forever on a silent endpoint", async () => {
    const fetchMock = respond({ status: "Completed", total_amount: 1200000 });

    vi.stubGlobal("fetch", fetchMock);

    await khaltiProvider.verify(attempt, sandbox);

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      signal: expect.any(AbortSignal),
    });
  });
});
