import "server-only";

import { verifyWebhook, type WebhookPayload } from "@softmato/sdk";

import { softmatoWebhookSecret } from "./config";

/**
 * The other authoritative answer: Softmato telling us money moved.
 *
 * Three mistakes are available here and all three are common, so all three are
 * closed in one place rather than at the route:
 *
 * **1. Verifying a re-serialised body.** The signature covers the exact bytes
 * that were sent. `JSON.stringify(parsedBody)` is a *different* string — key
 * order, whitespace, number formatting — and it fails for genuine deliveries
 * while looking like a signing bug. So this takes `string`, the route reads it
 * with `await request.text()`, and nothing between the socket and here parses
 * anything.
 *
 * **2. Asserting the headers exist.** `headers.get()` returns `null` when a
 * header is absent, and an absent signature is the *normal* case — a public
 * endpoint receives unauthenticated traffic simply for existing. The SDK's
 * types admit `null` and answer `missing_signature`; a `!` here would turn a
 * scanner's probe into a thrown `TypeError` in a route that is supposed to
 * answer 400 and forget about it.
 *
 * **3. Skipping the age check.** A delivery older than five minutes is a
 * replay of a captured request, not a delivery. The SDK enforces the window;
 * this file does not reimplement it.
 *
 * ## Verify before reading a single field
 *
 * Not before *acting* on one — before *reading* one. An unverified body is a
 * string a stranger chose, and that includes the `event` name you would branch
 * on and the `transaction_id` you would log. Nothing below touches the payload
 * until `verifyWebhook` has returned `valid: true`.
 */

export type WebhookOutcome =
  | { ok: true; payload: WebhookPayload }
  | { ok: false; reason: string; status: number };

export interface RawDelivery {
  body: string;
  signature: string | null;
  timestamp: string | null;
}

export function verifyDelivery(delivery: RawDelivery): WebhookOutcome {
  const secret = softmatoWebhookSecret();

  /*
   * No secret is a 503, not a 400. The delivery may well be genuine; we simply
   * cannot tell, and answering 400 would let Softmato's retry queue give up on
   * a payment we are unable to check. A 5xx keeps it retrying until the
   * deployment is configured, which is the outcome we want.
   */
  if (!secret) {
    return {
      ok: false,
      reason: "SOFTMATO_WEBHOOK_SECRET is not set on this deployment",
      status: 503,
    };
  }

  const result = verifyWebhook({
    body: delivery.body,
    secret,
    signature: delivery.signature,
    timestamp: delivery.timestamp,
  });

  if (!result.valid) {
    return { ok: false, reason: result.reason, status: 400 };
  }

  return { ok: true, payload: result.payload };
}

/**
 * The events that change something on our side.
 *
 * `payment.success` provisions. The rest are recorded and otherwise leave the
 * invoice exactly where it was — open, and payable again. **"The customer
 * cancelled" is an answer, not a failure**: a new payment against the same
 * invoice is the normal path, and marking the invoice failed would be us
 * closing a door the owner is about to walk through.
 *
 * Note what is not in this list: there is no event for a payment held for
 * reconciliation. A disagreement between Softmato and a provider is theirs to
 * resolve, and we are told when it resolves.
 */
export function isProvisioningEvent(payload: WebhookPayload): boolean {
  return payload.event === "payment.success";
}
