import { SHARED_VECTOR, sign } from "@softmato/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifyDelivery } from "@/modules/billing/softmato/webhook";

/**
 * The gate every provisioning decision comes through.
 *
 * The cases that matter are the ones where a *rejection* has to happen, and
 * where a rejection has to be an answer rather than a thrown error — a public
 * endpoint receives scanners and probes simply for existing, and an unsigned
 * POST is the normal traffic, not the exceptional case.
 */

const SECRET = "whsec_test_2f9a1c";
const previous = process.env.SOFTMATO_WEBHOOK_SECRET;

const body = JSON.stringify({
  amount: 500_000,
  currency: "NPR",
  event: "payment.success",
  invoice_id: "INV-2083/84-000010",
  occurred_at: "2026-09-09T00:00:00.000Z",
  status: "SUCCEEDED",
  transaction_id: "TXN-2083/84-00000008",
});

const now = () => String(Math.floor(Date.now() / 1000));

beforeEach(() => {
  process.env.SOFTMATO_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  if (previous === undefined) delete process.env.SOFTMATO_WEBHOOK_SECRET;
  else process.env.SOFTMATO_WEBHOOK_SECRET = previous;
});

describe("a genuine delivery", () => {
  it("verifies and hands back the parsed payload", () => {
    const timestamp = now();
    const result = verifyDelivery({
      body,
      signature: sign(SECRET, Number(timestamp), body),
      timestamp,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.transaction_id).toBe("TXN-2083/84-00000008");
    }
  });

  it("matches the vector both implementations assert", () => {
    /*
     * This is the contract between our consumer and their server. If it ever
     * changes, the wire format has changed and every deployed consumer breaks
     * with it — so it is asserted here rather than regenerated to pass.
     */
    expect(sign(SHARED_VECTOR.secret, SHARED_VECTOR.timestamp, SHARED_VECTOR.body)).toBe(
      SHARED_VECTOR.signature,
    );
  });
});

describe("the rejections", () => {
  it("answers rather than throws when there is no signature at all", () => {
    const result = verifyDelivery({ body, signature: null, timestamp: now() });

    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a body that has been re-serialised", () => {
    /*
     * The commonest way to get this wrong. The signature covers the exact bytes
     * that were sent, and a server is free to send whitespace and key order we
     * would not have chosen — as the raw string below does. `JSON.stringify` of
     * the parsed object is a *different* string, so verifying it fails for a
     * perfectly genuine delivery, which is why the route reads `request.text()`
     * and nothing between the socket and here parses anything.
     */
    const raw = `{
  "event": "payment.success",
  "transaction_id": "TXN-2083/84-00000008",
  "amount": 500000
}`;
    const timestamp = now();
    const signature = sign(SECRET, Number(timestamp), raw);

    expect(verifyDelivery({ body: raw, signature, timestamp }).ok).toBe(true);

    const reserialised = JSON.stringify(JSON.parse(raw));

    expect(reserialised).not.toBe(raw);
    expect(
      verifyDelivery({ body: reserialised, signature, timestamp }),
    ).toMatchObject({ ok: false, reason: "signature_mismatch" });
  });

  it("refuses a delivery older than the replay window", () => {
    const stale = String(Math.floor(Date.now() / 1000) - 3_600);

    const result = verifyDelivery({
      body,
      signature: sign(SECRET, Number(stale), body),
      timestamp: stale,
    });

    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a signature minted under a different secret", () => {
    const timestamp = now();

    const result = verifyDelivery({
      body,
      signature: sign("whsec_not_ours", Number(timestamp), body),
      timestamp,
    });

    expect(result).toMatchObject({ ok: false, reason: "signature_mismatch" });
  });
});

describe("an unconfigured deployment", () => {
  it("asks for the delivery again rather than discarding it", () => {
    /*
     * 503, not 400. The delivery may well be genuine and we simply cannot
     * check it; a 4xx would let their retry queue give up on a payment that has
     * already left a customer's wallet.
     */
    delete process.env.SOFTMATO_WEBHOOK_SECRET;

    const timestamp = now();
    const result = verifyDelivery({
      body,
      signature: sign(SECRET, Number(timestamp), body),
      timestamp,
    });

    expect(result).toMatchObject({ ok: false, status: 503 });
  });
});
