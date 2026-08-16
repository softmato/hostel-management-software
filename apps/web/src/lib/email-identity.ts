import {
  DEFAULT_MAILBOXES,
  envEmailDomain,
  fallbackEmailIdentity,
  setEmailIdentityResolver,
  SHIPPED_EMAIL_DOMAIN,
  type EmailIdentity,
} from "@hostel/shared/email/identity";

import { getSiteConfigSection } from "@/modules/platform-config/site-config.service";

/**
 * Feeds the platform owner's configured sender identity to `sendEmail()`.
 *
 * `packages/shared` has no database connection — it is shared with the mobile
 * app — so it exposes a resolver hook and this module fills it in. Registered
 * once from `instrumentation.ts`, which means every existing `sendEmail()` call
 * site, in every service and cron job, picks up the admin-configured name and
 * mailboxes without being touched.
 */

/**
 * Settings are read at most once a minute rather than once per email.
 *
 * A payment run or a notice broadcast sends hundreds of messages in a loop; a
 * database round-trip per message would turn a settings read into the slowest
 * part of sending. A minute is short enough that an owner who renames the site
 * sees it take effect while they are still on the page, and long enough that a
 * bulk send costs one read.
 */
const TTL_MS = 60_000;

let cached: { identity: EmailIdentity; readAt: number } | null = null;

/**
 * The read currently in flight, if any.
 *
 * Without this the TTL cache only helps *sequential* sends. A notice broadcast
 * or a billing run fires its messages concurrently, so every one of them misses
 * the empty cache at the same instant and starts its own settings read —
 * hundreds of round-trips for a value they will all agree on. Sharing the
 * promise collapses that back to one.
 */
let inFlight: Promise<EmailIdentity> | null = null;

/** Clears the cache — for tests, and for the settings save that changes it. */
export function resetEmailIdentityCache() {
  cached = null;
  inFlight = null;
}

export async function loadEmailIdentity(): Promise<EmailIdentity> {
  const now = Date.now();

  if (cached && now - cached.readAt < TTL_MS) {
    return cached.identity;
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = readEmailIdentity(now).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

async function readEmailIdentity(now: number): Promise<EmailIdentity> {
  const fallback = fallbackEmailIdentity();

  try {
    const [email, identity] = await Promise.all([
      getSiteConfigSection("email"),
      getSiteConfigSection("identity"),
    ]);

    const resolved: EmailIdentity = {
      // Env first for the domain, config second — the reverse of every other
      // field here. The domain has to match what Resend verified for this
      // deployment, and a deployment knows that; a settings form is where it
      // gets mistyped. The config value is the escape hatch for an owner on
      // their own domain, and the shipped default is the last word, so a
      // deployment that sets neither still sends.
      domain: envEmailDomain() || email.domain || SHIPPED_EMAIL_DOMAIN,
      mailboxes: {
        alert: email.alertMailbox || DEFAULT_MAILBOXES.alert,
        billing: email.billingMailbox || DEFAULT_MAILBOXES.billing,
        info: email.infoMailbox || DEFAULT_MAILBOXES.info,
        noreply: email.noreplyMailbox || DEFAULT_MAILBOXES.noreply,
        security: email.securityMailbox || DEFAULT_MAILBOXES.security,
        support: email.supportMailbox || DEFAULT_MAILBOXES.support,
      },
      // Only what was explicitly set for email. `identity.supportEmail` is
      // deliberately NOT consulted: it is a contact detail printed in the
      // public footer, and its shipped default is `support@hostelhub.com.np`,
      // a domain nobody owns. Adopting it here made the default configuration
      // send every reply into a bounce. Left empty, `replyToFor()` derives an
      // address on the domain we already send from, which cannot.
      replyTo: email.replyTo || fallback.replyTo,
      senderName: email.senderName || identity.siteName || fallback.senderName,
    };

    cached = { identity: resolved, readAt: now };

    return resolved;
  } catch {
    // An unreachable settings collection must not stop an SOS email. Cached
    // briefly so a database outage does not mean a failed read per message.
    cached = { identity: fallback, readAt: now };

    return fallback;
  }
}

let registered = false;

export function registerEmailIdentity() {
  if (registered) {
    return;
  }

  registered = true;
  setEmailIdentityResolver(loadEmailIdentity);
}
