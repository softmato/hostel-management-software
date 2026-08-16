/**
 * Next's boot hook. `register()` runs once when the server starts, before it
 * serves anything.
 *
 * This exists for one reason: `validateServerEnv()` was written early and then
 * never called, so the environment was only ever checked implicitly, by a
 * request happening to need a key. A mistyped `JWT_ACCESS_SECRET` surfaced as a
 * confusing failure at the first login rather than as a failed deploy, and a
 * missing `R2_BUCKET_NAME` waited for the first upload. Boot is the right time
 * to find out.
 *
 * Guarded on `NEXT_RUNTIME === "nodejs"` because the same hook is invoked for
 * the edge runtime, where most of `process.env` is not present and a check
 * would fail on a deployment that is fine.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  // First, before anything reads process.env: Next only loads env files from
  // `apps/web`, so the repo-root `.env` this project documents has to be merged
  // in explicitly. It fills gaps only — `apps/web/.env.local` still wins.
  await import("@/lib/load-root-env");

  const { serverEnvWarnings, validateServerEnv } = await import("@/lib/env");
  const { logger } = await import("@/lib/logger");

  // Throws on anything that makes this deployment unusable. Deliberately not
  // caught: a build that cannot serve requests should fail visibly at start
  // rather than accept traffic it will mishandle.
  validateServerEnv();

  for (const warning of serverEnvWarnings()) {
    logger.warn(warning);
  }

  // Points `sendEmail()` at the platform owner's configured sender identity.
  // Registering a resolver rather than reading settings here: this runs before
  // the database is necessarily reachable, and the identity has to stay live
  // after an admin edits it, not be frozen at boot.
  const { registerEmailIdentity } = await import("@/lib/email-identity");

  registerEmailIdentity();
}
