import "server-only";

import { SoftmatoClient } from "@softmato/sdk";

import { softmatoConfig } from "./config";

/**
 * The one client instance, and the one place the secret is read.
 *
 * `@softmato/sdk` imports `node:crypto` and every call it makes carries the
 * client secret, so it is server-side only — deliberately, and enforced by the
 * `server-only` import above rather than by remembering. A component that
 * reaches the browser cannot import this file without the build failing, which
 * is the point: anything shipped to a device is public no matter what it is
 * called.
 *
 * ## Why it is a singleton
 *
 * `/api/v1` is rate limited per IP at the edge, and the guidance is one
 * connection pool rather than a burst of parallel clients. A module-level
 * instance also means the rotation warning below is registered once instead of
 * once per request.
 *
 * ## The warning is logged, never thrown
 *
 * After a rotation the superseded secret keeps authenticating for 24 hours, and
 * every response during that window carries `Softmato-Secret-Expires`. The SDK
 * surfaces it as a callback because the call *succeeded* — failing it would
 * break a working integration in order to warn it that it is about to break.
 *
 * It is logged at `error` on purpose. It is not an error today; it is an
 * outage on a date, and the only warning that arrives before the `401`s start.
 */

let cached: SoftmatoClient | null = null;

export class SoftmatoNotConfiguredError extends Error {
  readonly code = "SOFTMATO_NOT_CONFIGURED";

  constructor() {
    super(
      "Softmato is not configured on this deployment, so no online subscription payment can be taken. Set SOFTMATO_SECRET, SOFTMATO_WEBHOOK_SECRET and SOFTMATO_BASE_URL.",
    );
    this.name = "SoftmatoNotConfiguredError";
  }
}

export function softmato(): SoftmatoClient {
  if (cached) return cached;

  const config = softmatoConfig();

  if (!config) throw new SoftmatoNotConfiguredError();

  cached = new SoftmatoClient({
    baseUrl: config.baseUrl,
    onWarning: (warning) => {
      console.error(
        JSON.stringify({
          action: "softmato_secret_expiring",
          code: warning.code,
          expiresAt: warning.expiresAt.toISOString(),
          level: "error",
          message: warning.message,
        }),
      );
    },
    secret: config.secret,
  });

  return cached;
}

/** Test seam. Nothing in the app calls this. */
export function resetSoftmatoClient(): void {
  cached = null;
}
