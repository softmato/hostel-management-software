import type { NextRequest } from "next/server";

import { applyWebhook } from "@/modules/billing/subscription-webhook.service";
import { verifyDelivery } from "@/modules/billing/softmato/webhook";

export const runtime = "nodejs";
/*
 * Never cached, never prerendered. A webhook endpoint that a build could
 * evaluate is one that answers from a snapshot taken at deploy time.
 */
export const dynamic = "force-dynamic";

/**
 * Where Softmato tells us money moved.
 *
 * This is the endpoint that provisions. Not the return page — the owner
 * reaches that by clicking, and they can reach it without paying. Not the
 * existence of an invoice, which is a request for money rather than money.
 * Here, on a signature we verified, or on a server-side transaction read.
 *
 * ## The body is read as bytes, and that is not a detail
 *
 * `request.text()`, before anything parses it. The signature covers the exact
 * bytes that were sent, and `JSON.stringify` of whatever a framework parsed is
 * a *different* string — different key order, different number formatting,
 * different whitespace. Verifying that re-serialised body fails for genuine
 * deliveries while a forged one, never checked, would sail through.
 *
 * ## Unauthenticated traffic is expected, not exceptional
 *
 * A public URL receives scanners, probes and mistakes simply for existing.
 * None of that is logged as an incident and none of it throws: a missing
 * signature is answered `400` and forgotten. The headers are passed through as
 * `null` rather than asserted with `!`, because `headers.get()` returning
 * `null` is the normal case here.
 *
 * ## Why the status codes are what they are
 *
 * `2xx` stops the retries, so it is reserved for deliveries we have finished
 * with — including ones we deliberately ignored, because an invoice number we
 * do not recognise will not start being recognised on the fourth attempt.
 *
 * A failure *we* caused answers `5xx` so the delivery is retried. That is the
 * whole value of the retry queue: a database that was briefly down must not
 * cost a hostel the plan they paid for.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();

  const verified = verifyDelivery({
    body: raw,
    signature: request.headers.get("x-softmato-signature"),
    timestamp: request.headers.get("x-softmato-timestamp"),
  });

  if (!verified.ok) {
    console.warn(
      JSON.stringify({
        action: "softmato_webhook_rejected",
        level: "warn",
        reason: verified.reason,
      }),
    );

    return new Response(verified.reason, { status: verified.status });
  }

  try {
    const result = await applyWebhook(verified.payload);

    console.info(
      JSON.stringify({
        action: "softmato_webhook_handled",
        event: verified.payload.event,
        level: result.action === "ignored" ? "warn" : "info",
        outcome: result.action,
        transactionId: verified.payload.transaction_id,
      }),
    );

    return Response.json({ received: true, outcome: result.action });
  } catch (error) {
    /*
     * Deliberately a 500. The delivery was genuine and we failed to act on it,
     * so we want it again — swallowing it with a 200 would lose a payment that
     * has already left the customer's wallet.
     */
    console.error(
      JSON.stringify({
        action: "softmato_webhook_failed",
        event: verified.payload.event,
        level: "error",
        message: error instanceof Error ? error.message : String(error),
        transactionId: verified.payload.transaction_id,
      }),
    );

    return new Response("retry", { status: 500 });
  }
}
