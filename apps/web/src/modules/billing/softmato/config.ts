import "server-only";

/**
 * Where the Softmato credentials come from, and what "not configured" means.
 *
 * Three variables, read here and nowhere else so there is one answer to "is
 * this deployment able to take a subscription payment":
 *
 * - `SOFTMATO_SECRET` — the client secret, `Authorization: Bearer`. Issued
 *   once and never readable again; a lost one is rotated, not recovered.
 * - `SOFTMATO_WEBHOOK_SECRET` — a **different** credential, in the other
 *   direction. The client secret proves we are us to them; this proves they
 *   are them to us. Neither works in the other's place, and the webhook route
 *   refuses to start verifying without this one rather than falling back.
 * - `SOFTMATO_BASE_URL` — which deployment. This is the variable that decides
 *   whether real money moves.
 *
 * ## Sandbox is not a safety net
 *
 * A `sk_test_` secret does **not** mean payments are pretend. Sandbox is a
 * label on the identifier: it picks the `app_test_` prefix and nothing else.
 * It selects no provider, changes no gateway and keeps nothing out of anyone's
 * ledger. What decides whether a customer's wallet is really debited is the
 * deployment `SOFTMATO_BASE_URL` names — so a Sandbox secret pointed at
 * production takes real money through the real gateways.
 *
 * Hence the default below. There isn't one: an unset `SOFTMATO_BASE_URL` is a
 * configuration error, not an invitation to guess `softmato.com`.
 */

export interface SoftmatoConfig {
  baseUrl: string;
  secret: string;
  webhookSecret: string;
}

/**
 * Softmato is optional to *boot* and required to *charge*.
 *
 * A hostel that only ever takes cash, a CI run, a `next dev` for the map
 * screens — none of those need a credential, and a deployment that refused to
 * start without one would make every unrelated bit of work depend on a
 * payments integration. So absence is a configuration state, checked at the
 * point of use, rather than a boot failure.
 */
export function softmatoConfig(): SoftmatoConfig | null {
  const baseUrl = process.env.SOFTMATO_BASE_URL?.trim();
  const secret = process.env.SOFTMATO_SECRET?.trim();
  const webhookSecret = process.env.SOFTMATO_WEBHOOK_SECRET?.trim();

  if (!baseUrl || !secret || !webhookSecret) return null;

  return { baseUrl, secret, webhookSecret };
}

export function isSoftmatoConfigured(): boolean {
  return softmatoConfig() !== null;
}

/**
 * The webhook secret on its own.
 *
 * Separate from `softmatoConfig()` because the webhook route legitimately runs
 * on a deployment that never calls the API — and because a route that verified
 * signatures only when a *client* secret happened to be present would silently
 * stop verifying the day someone rotated the wrong one.
 */
export function softmatoWebhookSecret(): string | null {
  return process.env.SOFTMATO_WEBHOOK_SECRET?.trim() || null;
}
