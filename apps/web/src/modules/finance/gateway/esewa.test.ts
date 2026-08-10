/**
 * eSewa ePay v2 adapter — Block 6 item 6.3 of
 * docs/FINANCE_IMPLEMENTATION_PLAN.md.
 *
 * Two kinds of test here. The first pins the *format* eSewa demands — the signed
 * field order, the comma-joined message, the base64 digest — because getting any
 * of it wrong produces a rejection that says nothing about why, and because it is
 * the kind of detail a later refactor silently breaks.
 *
 * The second is about what must never settle: a tampered payload, an amount with
 * a thousands separator that would otherwise parse to NaN, an `AMBIGUOUS` status
 * where eSewa itself does not know, and a refunded transaction.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { esewaProvider } from "./esewa.provider";
import type { GatewayCredentials } from "./provider.types";

const SECRET = "8gBm/:&EnhH.1/q";

const sandbox: GatewayCredentials = {
  merchantCode: "EPAYTEST",
  provider: "ESEWA",
  sandbox: true,
  secret: SECRET,
  webhookSecret: SECRET,
};

const live: GatewayCredentials = { ...sandbox, merchantCode: "RUPA001", sandbox: false };

const request = {
  amount: 12000,
  attempt: 1,
  callbackUrl: "https://softmato.test/api/v1/webhooks/esewa",
  credentials: sandbox,
  failureUrl: "https://softmato.test/resident/payments/checkout/EDU-0001-F-1?outcome=failed",
  invoiceId: "64f0f0f0f0f0f0f0f0f0f0c1",
  reference: "EDU-0001-F-1",
  referenceCode: "EDU-0001-F",
  returnUrl: "https://softmato.test/resident/payments/checkout/EDU-0001-F-1",
};

/** Signs exactly as eSewa documents it, independently of the adapter. */
function signAs(fields: string[], values: Record<string, string>, secret = SECRET) {
  return createHmac("sha256", secret)
    .update(fields.map((field) => `${field}=${values[field] ?? ""}`).join(","))
    .digest("base64");
}

/** A success payload as eSewa returns it on the resident's return URL. */
function successPayload(
  overrides: Record<string, unknown> = {},
): Record<string, string> {
  const values: Record<string, string> = {
    product_code: "EPAYTEST",
    signed_field_names:
      "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names",
    status: "COMPLETE",
    total_amount: "12,000.0",
    transaction_code: "000AWEO",
    transaction_uuid: "EDU-0001-F-1",
    ...(overrides as Record<string, string>),
  };

  return {
    ...values,
    signature: signAs(String(values.signed_field_names).split(","), values),
  };
}

function encode(payload: unknown) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

describe("creating a checkout", () => {
  it("posts to the sandbox form when the credentials are sandbox", async () => {
    const intent = await esewaProvider.createIntent(request);

    expect(intent.handoff).toMatchObject({
      kind: "FORM_POST",
      url: "https://rc-epay.esewa.com.np/api/epay/main/v2/form",
    });
  });

  it("posts to the live form otherwise", async () => {
    const intent = await esewaProvider.createIntent({ ...request, credentials: live });

    expect((intent.handoff as { url: string }).url).toBe(
      "https://epay.esewa.com.np/api/epay/main/v2/form",
    );
  });

  /**
   * Order is part of the algorithm, not a formatting choice. Sorting these, or
   * building the message from an object's own key order, produces a signature
   * eSewa rejects with an error that says nothing about why.
   */
  it("signs total_amount, transaction_uuid and product_code, in that order", async () => {
    const intent = await esewaProvider.createIntent(request);
    const fields = (intent.handoff as { fields: Record<string, string> }).fields;

    expect(fields.signed_field_names).toBe(
      "total_amount,transaction_uuid,product_code",
    );
    expect(fields.signature).toBe(
      signAs(["total_amount", "transaction_uuid", "product_code"], fields),
    );
  });

  it("sends the per-attempt reference as the transaction uuid", async () => {
    // eSewa rejects a repeated transaction_uuid, so this is what makes a retry
    // of the same invoice payable at all.
    const intent = await esewaProvider.createIntent(request);

    expect(
      (intent.handoff as { fields: Record<string, string> }).fields.transaction_uuid,
    ).toBe("EDU-0001-F-1");
  });

  it("carries no tax or service charges we did not charge", async () => {
    const fields = (
      (await esewaProvider.createIntent(request)).handoff as {
        fields: Record<string, string>;
      }
    ).fields;

    expect(fields).toMatchObject({
      amount: "12000",
      product_delivery_charge: "0",
      product_service_charge: "0",
      tax_amount: "0",
      total_amount: "12000",
    });
  });

  it("issues no provider reference, because eSewa has none yet", async () => {
    expect((await esewaProvider.createIntent(request)).providerRef).toBeNull();
  });
});

describe("the payload eSewa hands back", () => {
  it("accepts a correctly signed payload, base64 or decoded", () => {
    const payload = successPayload();

    expect(esewaProvider.parseWebhook(encode(payload), {}, sandbox)).toMatchObject({
      providerTxnId: "000AWEO",
      reference: "EDU-0001-F-1",
    });
    expect(
      esewaProvider.parseWebhook(JSON.stringify(payload), {}, sandbox),
    ).toMatchObject({ reference: "EDU-0001-F-1" });
  });

  /** `"12,000.0"` through `Number()` is NaN, which would refuse every settlement. */
  it("reads an amount carrying a thousands separator", () => {
    expect(esewaProvider.parseWebhook(encode(successPayload()), {}, sandbox)).toMatchObject(
      { amount: 12000 },
    );
  });

  it("rejects a payload whose amount was edited after signing", () => {
    const payload = { ...successPayload(), total_amount: "1.0" };

    expect(esewaProvider.parseWebhook(encode(payload), {}, sandbox)).toBeNull();
  });

  it("rejects a payload signed with another merchant's key", () => {
    const values = successPayload();
    const forged = {
      ...values,
      signature: signAs(values.signed_field_names.split(","), values, "someone-else"),
    };

    expect(esewaProvider.parseWebhook(encode(forged), {}, sandbox)).toBeNull();
  });

  it.each([
    ["no signature", { signature: "" }],
    ["no declared fields", { signed_field_names: "" }],
    ["no transaction uuid", { transaction_uuid: "" }],
  ])("rejects a payload with %s", (_label, overrides) => {
    const payload = { ...successPayload(), ...overrides };

    expect(esewaProvider.parseWebhook(encode(payload), {}, sandbox)).toBeNull();
  });

  it("rejects anything that is not a payload at all", () => {
    expect(esewaProvider.parseWebhook("not base64 json", {}, sandbox)).toBeNull();
    expect(esewaProvider.parseWebhook("", {}, sandbox)).toBeNull();
  });

  /**
   * eSewa declares which fields it signed, and that set differs from the one we
   * sign on the way out. Reading it from the payload rather than hard-coding it
   * is what keeps this working when they add a field.
   */
  it("verifies against the field list eSewa declares, not our own", () => {
    const values: Record<string, string> = {
      product_code: "EPAYTEST",
      signed_field_names: "transaction_uuid,product_code",
      status: "COMPLETE",
      total_amount: "12000",
      transaction_code: "000AWEO",
      transaction_uuid: "EDU-0001-F-1",
    };
    const payload = {
      ...values,
      signature: signAs(["transaction_uuid", "product_code"], values),
    };

    expect(esewaProvider.parseWebhook(encode(payload), {}, sandbox)).toMatchObject({
      reference: "EDU-0001-F-1",
    });
  });
});

describe("asking eSewa what happened", () => {
  const attempt = { amount: 12000, providerTxnId: null, reference: "EDU-0001-F-1" };

  function respond(body: unknown, ok = true) {
    return vi.fn().mockResolvedValue({
      ok,
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", respond({}));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queries by our reference and the amount, as eSewa defines it", async () => {
    const fetchMock = respond({ status: "COMPLETE", total_amount: 12000 });

    vi.stubGlobal("fetch", fetchMock);

    await esewaProvider.verify(attempt, sandbox);

    const url = new URL(fetchMock.mock.calls[0]![0] as string);

    expect(url.origin + url.pathname).toBe(
      "https://rc.esewa.com.np/api/epay/transaction/status/",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      product_code: "EPAYTEST",
      total_amount: "12000",
      transaction_uuid: "EDU-0001-F-1",
    });
  });

  it("uses the live status endpoint for live credentials", async () => {
    const fetchMock = respond({ status: "COMPLETE", total_amount: 12000 });

    vi.stubGlobal("fetch", fetchMock);

    await esewaProvider.verify(attempt, live);

    expect(fetchMock.mock.calls[0]![0]).toContain("https://esewa.com.np/");
  });

  it("returns eSewa's own amount, not the one we asked for", async () => {
    // The caller compares the two. Echoing our own number back would make that
    // check tautological and let a mismatched charge settle.
    vi.stubGlobal("fetch", respond({ ref_id: "0007T6M", status: "COMPLETE", total_amount: 9000 }));

    expect(await esewaProvider.verify(attempt, sandbox)).toMatchObject({
      amount: 9000,
      providerTxnId: "0007T6M",
      status: "SUCCESS",
    });
  });

  it.each([
    ["COMPLETE", "SUCCESS"],
    ["PENDING", "PENDING"],
    ["AMBIGUOUS", "PENDING"],
    ["CANCELED", "FAILED"],
    ["NOT_FOUND", "FAILED"],
    ["FULL_REFUND", "FAILED"],
    ["PARTIAL_REFUND", "FAILED"],
    ["SOMETHING_NEW", "FAILED"],
  ])("maps %s to %s", async (esewaStatus, expected) => {
    vi.stubGlobal("fetch", respond({ status: esewaStatus, total_amount: 12000 }));

    expect((await esewaProvider.verify(attempt, sandbox)).status).toBe(expected);
  });

  it("falls back to our reference when eSewa returns no id", async () => {
    // The ledger's idempotency key is built from this, so it can never be empty.
    vi.stubGlobal("fetch", respond({ status: "COMPLETE", total_amount: 12000 }));

    expect((await esewaProvider.verify(attempt, sandbox)).providerTxnId).toBe(
      "EDU-0001-F-1",
    );
  });

  it("reports an unreachable eSewa rather than a failed payment", async () => {
    // Closing the attempt here would write off a payment the resident may well
    // have completed.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    await expect(esewaProvider.verify(attempt, sandbox)).rejects.toMatchObject({
      errorCode: "GATEWAY_UNREACHABLE",
    });
  });

  it("treats an HTML error page the same way", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        text: () => Promise.resolve("<html>502 Bad Gateway</html>"),
      }),
    );

    await expect(esewaProvider.verify(attempt, sandbox)).rejects.toMatchObject({
      errorCode: "GATEWAY_UNREACHABLE",
    });
  });

  it("does not hang forever on a silent endpoint", async () => {
    const fetchMock = respond({ status: "COMPLETE", total_amount: 12000 });

    vi.stubGlobal("fetch", fetchMock);

    await esewaProvider.verify(attempt, sandbox);

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      signal: expect.any(AbortSignal),
    });
  });
});
