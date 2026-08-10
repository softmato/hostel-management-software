import type { NextRequest } from "next/server";

import { errorResponse, handleRouteError, successResponse } from "@/lib/api-response";
import { handleProviderCallback } from "@/modules/finance/gateway/intent.service";
import type { GatewayProviderName } from "@/modules/finance/gateway/provider.types";

export const runtime = "nodejs";

const PROVIDERS = new Set(["esewa", "fonepay", "khalti"]);

/**
 * A payment provider's callback (target §6.5, plan item 6.2).
 *
 * **Unauthenticated by necessity, and trusted for nothing.** The provider has no
 * credential of ours to present, so the body's signature is the only thing
 * separating this from a stranger's POST — and even a valid signature proves
 * only that the provider sent the message, never that money moved or how much.
 * The service verifies against the provider's own API before anything settles.
 *
 * Two response rules, both about what a provider does with a non-2xx:
 *
 * - A callback for a reference we never issued answers 200. Providers retry on
 *   failure, and a reference we do not recognise would be retried forever;
 *   it is also exactly what a probe looks like.
 * - A callback whose signature does not verify answers 4xx, because that one is
 *   worth being noisy about.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await context.params;
    const slug = provider.toLowerCase();

    if (!PROVIDERS.has(slug)) {
      return errorResponse("Unknown payment provider.", "NOT_FOUND", 404);
    }

    const headers: Record<string, string> = {};

    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const outcome = await handleProviderCallback(
      slug.toUpperCase() as GatewayProviderName,
      await request.text(),
      headers,
    );

    // Deliberately thin. A callback endpoint that reports what it did tells an
    // unauthenticated caller whether a reference exists and whether it settled.
    return successResponse({ received: true }, outcome.settled ? "Settled" : "Received");
  } catch (error) {
    return handleRouteError(error);
  }
}
