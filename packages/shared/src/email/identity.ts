import { PRODUCT_NAME } from "../index";

/**
 * What kind of mail this is — and therefore which mailbox it comes from.
 *
 * Softmato runs one verified sending domain shared by every product
 * (docs/EMAIL_SYSTEM.md §0). Because the domain is verified as a whole, any
 * local-part on it can send without its own verification, so the local-part is
 * free to carry meaning: a resident who sees `alert@` in their inbox knows
 * before opening it that this one is not a receipt.
 *
 * The split is by *what the mail is*, not by which module sent it — a payment
 * gateway going down is an `alert` even though it comes out of the finance
 * module, and a password reset is `security` even though auth also sends
 * ordinary `info` mail.
 */
export type EmailCategory =
  /** Ordinary product mail: notices, approvals, invitations, confirmations. */
  | "info"
  /** Something needs attention now: SOS, overdue fees, a gateway that is down. */
  | "alert"
  /** Money: invoices, receipts, reminders, refunds. */
  | "billing"
  /** Credentials and account safety: OTPs, resets, deletion, new logins. */
  | "security"
  /** Mail a person is expected to reply to: inquiries, complaint threads. */
  | "support"
  /** Machine mail with nothing to say back to. */
  | "noreply";

export const EMAIL_CATEGORIES: EmailCategory[] = [
  "info",
  "alert",
  "billing",
  "security",
  "support",
  "noreply",
];

export const DEFAULT_EMAIL_CATEGORY: EmailCategory = "info";

/**
 * Shipped local-parts. Overridable by the platform owner, because which
 * mailboxes exist is their decision, not ours — see `EmailIdentity.mailboxes`.
 */
export const DEFAULT_MAILBOXES: Record<EmailCategory, string> = {
  alert: "alert",
  billing: "billing",
  info: "info",
  noreply: "noreply",
  security: "security",
  support: "support",
};

/**
 * A suffix on the display name, so the sender reads as the department it is
 * rather than as one undifferentiated robot. `info` and `noreply` get none —
 * they are the product speaking as itself.
 */
const NAME_SUFFIX: Record<EmailCategory, string> = {
  alert: "Alerts",
  billing: "Billing",
  info: "",
  noreply: "",
  security: "Security",
  support: "Support",
};

export type EmailIdentity = {
  /**
   * Domain the mail is sent from. **Must be a domain verified in Resend** —
   * an unverified one is not a degraded send, it is a rejected one.
   */
  domain: string;
  /** Local-part per category, e.g. `{ billing: "billing" }` → `billing@domain`. */
  mailboxes: Record<EmailCategory, string>;
  /**
   * Explicit reply address. Empty means "derive one" — see `replyToFor()`.
   *
   * Whatever is put here must be a mailbox that actually receives. A reply is
   * the one part of an email the product cannot test by sending: Resend reports
   * a successful send either way, and the failure surfaces days later as a
   * bounce in someone else's inbox.
   */
  replyTo: string;
  /** Display name, before the per-category suffix. */
  senderName: string;
};

/**
 * Last-resort identity, used when nothing has registered a resolver — a script,
 * a test, or the split second before `instrumentation.ts` runs.
 *
 * `EMAIL_DOMAIN` is the one piece that stays in the environment. Everything
 * else about the sender is the platform owner's to change from the admin UI,
 * but the domain is not a branding choice: it is the domain Resend has verified
 * for this deployment, and letting it be typed into a settings form would mean
 * a single typo silently stops all email.
 */
export function fallbackEmailIdentity(): EmailIdentity {
  return {
    domain: envEmailDomain() || SHIPPED_EMAIL_DOMAIN,
    mailboxes: { ...DEFAULT_MAILBOXES },
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || "",
    senderName: PRODUCT_NAME,
  };
}

/** The shared Softmato sending domain — right for this product, not universal. */
export const SHIPPED_EMAIL_DOMAIN = "softmato.com";

/**
 * `EMAIL_DOMAIN`, or empty. Separate from `fallbackEmailIdentity()` because a
 * caller assembling a full identity has to be able to tell "the deployment set
 * a domain" from "nothing did, so this is the shipped default" — collapsing
 * them is what makes an admin-configured domain unreachable.
 */
export function envEmailDomain() {
  return process.env.EMAIL_DOMAIN?.trim() ?? "";
}

type EmailIdentityResolver = () => Promise<EmailIdentity> | EmailIdentity;

let resolver: EmailIdentityResolver | null = null;

/**
 * Points the sender at the live, admin-configured identity.
 *
 * This package cannot read the database — it is shared with the mobile app and
 * has no connection of its own — but every email still has to carry whatever
 * name the platform owner typed into Website Config. So `apps/web` registers a
 * resolver at boot (`apps/web/src/lib/email-identity.ts`) and every existing
 * `sendEmail()` call site picks it up without changing.
 */
export function setEmailIdentityResolver(next: EmailIdentityResolver | null) {
  resolver = next;
}

/** Never throws: a settings read that fails must not stop an SOS going out. */
export async function resolveEmailIdentity(): Promise<EmailIdentity> {
  if (!resolver) {
    return fallbackEmailIdentity();
  }

  try {
    return await resolver();
  } catch {
    return fallbackEmailIdentity();
  }
}

/**
 * `{ category, identity }` → a `From` header.
 *
 * Returns null only when there is no domain at all, which is how a deployment
 * with email switched off is expressed — `sendEmail()` logs and no-ops rather
 * than throwing.
 */
export function fromHeaderFor(category: EmailCategory, identity: EmailIdentity) {
  const domain = identity.domain.trim().replace(/^@/, "");

  if (!domain) {
    return null;
  }

  const mailbox = (
    identity.mailboxes[category] ||
    DEFAULT_MAILBOXES[category] ||
    DEFAULT_MAILBOXES.info
  ).trim();
  const address = `${mailbox}@${domain}`;

  // Sanitise BEFORE falling back, not after. A name of `"<>` is not a name —
  // it survives an `|| PRODUCT_NAME` check as truthy, then sanitises down to
  // nothing, and the mail goes out with a bare address and no branding at all.
  // The characters are stripped rather than escaped because they would break
  // the header and no legitimate sender name needs them, and because this field
  // is admin-editable: without this, whoever can edit site settings could
  // append `<attacker@evil.test>` and rewrite the envelope of platform mail.
  const cleaned = identity.senderName.replace(/["\\,;<>]/g, "").trim();
  const suffix = NAME_SUFFIX[category];
  const name = [cleaned || PRODUCT_NAME, suffix].filter(Boolean).join(" ");

  return `${name} <${address}>`;
}

/**
 * Where a reply to this message should land.
 *
 * Derived from the **sending domain** when nothing is configured, rather than
 * borrowed from the site's public support address. Those are different things
 * that happen to look alike: the support address is a contact detail printed in
 * the footer, chosen for humans to read, and its shipped default points at a
 * domain nobody owns. Using it here meant the out-of-the-box configuration sent
 * every reply to a non-existent host — the sender was flawless, and every reply
 * bounced.
 *
 * The derived address is on the domain we already send from, so it can never
 * point somewhere unowned. It uses the `info` mailbox because that is the one a
 * deployment is most likely to have set up to *receive*: sending needs only the
 * domain verified, but receiving needs a forwarding alias per address, and
 * `info@` is the conventional first one.
 *
 * `noreply` gets none. That is the entire meaning of the category, and a
 * `Reply-To` on it would be the product contradicting its own address.
 */
export function replyToFor(category: EmailCategory, identity: EmailIdentity) {
  if (category === "noreply") {
    return "";
  }

  const configured = identity.replyTo.trim();

  if (configured) {
    return configured;
  }

  const domain = identity.domain.trim().replace(/^@/, "");

  if (!domain) {
    return "";
  }

  const mailbox = (identity.mailboxes.info || DEFAULT_MAILBOXES.info).trim();

  return `${mailbox}@${domain}`;
}
