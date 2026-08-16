/**
 * Sends one real email per category to a given address.
 *
 * What this proves that a unit test cannot: that the sending domain is actually
 * verified in Resend, that each `<mailbox>@domain` is accepted, and that the
 * `From` line a recipient sees is the one intended. Run it after any change to
 * the sending domain, the Resend account, or the DNS records behind either.
 *
 *   npm run web:send:test-emails -- you@example.com
 *   npm run web:send:test-emails -- you@example.com --category alert
 *   npm run web:send:test-emails -- you@example.com --dry-run
 *
 * `--dry-run` resolves and prints every `From` header without contacting
 * Resend, which is the safe way to check the identity before spending sends.
 *
 * It resolves the sender identity the same way the running app does — reading
 * the `email` and `identity` sections of site config out of MongoDB — so what
 * arrives is what the platform owner has configured, not a script's idea of it.
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MAILBOXES,
  EMAIL_CATEGORIES,
  envEmailDomain,
  fromHeaderFor,
  replyToFor,
  setEmailIdentityResolver,
  SHIPPED_EMAIL_DOMAIN,
  type EmailCategory,
  type EmailIdentity,
} from "../../../packages/shared/src/email/identity";
import { sendEmail } from "../../../packages/shared/src/email/sender";
import { otpCodeEmail } from "../../../packages/shared/src/email/templates/auth/otp-code";
import { sosAlertEmail } from "../../../packages/shared/src/email/templates/guardian/sos-alert";
import { paymentVerifiedEmail } from "../../../packages/shared/src/email/templates/payment/payment-verified";
import { complaintResolvedEmail } from "../../../packages/shared/src/email/templates/resident/complaint-resolved";
import { residentNewNoticeEmail } from "../../../packages/shared/src/email/templates/resident/new-notice";
import {
  emailLayout,
  paragraph,
  type EmailContent,
} from "../../../packages/shared/src/email/templates/layout";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

nextEnv.loadEnvConfig(repoRoot);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = args.includes("--category")
  ? (args[args.indexOf("--category") + 1] as EmailCategory)
  : null;
const recipient = args.find((arg) => arg.includes("@"));

if (!recipient) {
  console.error(
    "Usage: npm run web:send:test-emails -- <address> [--category <name>] [--dry-run]",
  );
  process.exit(1);
}

if (only && !EMAIL_CATEGORIES.includes(only)) {
  console.error(`Unknown category "${only}". One of: ${EMAIL_CATEGORIES.join(", ")}`);
  process.exit(1);
}

/**
 * Mirrors `apps/web/src/lib/email-identity.ts`, but reading the settings
 * collection directly — the app's version imports through `@/` path aliases
 * that only exist inside Next's build.
 */
async function loadIdentityFromDatabase(): Promise<EmailIdentity> {
  const uri = process.env.MONGODB_URI;

  const shipped: EmailIdentity = {
    domain: envEmailDomain() || SHIPPED_EMAIL_DOMAIN,
    mailboxes: { ...DEFAULT_MAILBOXES },
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || "",
    senderName: "",
  };

  if (!uri) {
    console.warn("! MONGODB_URI unset — using shipped defaults, not your settings.");

    return shipped;
  }

  await mongoose.connect(uri);

  const settings = mongoose.connection.collection("platformsettings");
  const [emailDoc, identityDoc] = await Promise.all([
    settings.findOne({ key: "email" }),
    settings.findOne({ key: "identity" }),
  ]);

  const email = (emailDoc?.value ?? {}) as Record<string, string>;
  const identity = (identityDoc?.value ?? {}) as Record<string, string>;

  return {
    domain: envEmailDomain() || email.domain || SHIPPED_EMAIL_DOMAIN,
    mailboxes: {
      alert: email.alertMailbox || DEFAULT_MAILBOXES.alert,
      billing: email.billingMailbox || DEFAULT_MAILBOXES.billing,
      info: email.infoMailbox || DEFAULT_MAILBOXES.info,
      noreply: email.noreplyMailbox || DEFAULT_MAILBOXES.noreply,
      security: email.securityMailbox || DEFAULT_MAILBOXES.security,
      support: email.supportMailbox || DEFAULT_MAILBOXES.support,
    },
    // Not `identity.supportEmail` — see the comment in
    // `apps/web/src/lib/email-identity.ts`. Empty means "derive from the
    // sending domain", which is what `replyToFor()` does.
    replyTo: email.replyTo || shipped.replyTo,
    senderName: email.senderName || identity.siteName || "",
  };
}

const HOSTEL = "Test Hostel (email check)";

/**
 * One real template per category, so what lands in the inbox is what a resident
 * would actually receive rather than a lorem-ipsum stand-in. `noreply` has no
 * template of its own — nothing in the product currently uses it — so it gets a
 * plain message built from the shared layout.
 */
function sampleFor(category: EmailCategory): EmailContent {
  switch (category) {
    case "alert":
      return sosAlertEmail({
        actionUrl: "https://example.test/hostel-admin/sos",
        hostelName: HOSTEL,
        message: "This is a test alert. Nobody is in danger.",
        recipientKind: "STAFF",
        residentName: "Test Resident",
        residentPhone: "+977-98XXXXXXXX",
        triggeredAt: new Date(),
      });
    case "billing":
      return paymentVerifiedEmail({
        amount: 8500,
        hostelName: HOSTEL,
        month: new Date().toISOString().slice(0, 7),
        paymentsUrl: "https://example.test/resident/payments",
        receiptNumber: "TEST-0001",
        remainingAmount: 0,
        residentName: "Test Resident",
      });
    case "security":
      return otpCodeEmail({ code: "123456", expiresInMinutes: 10 });
    case "support":
      return complaintResolvedEmail({
        complaintsUrl: "https://example.test/resident/complaints",
        hostelName: HOSTEL,
        response: "This is a test. No complaint was filed.",
        title: "Test complaint",
      });
    case "noreply":
      return {
        category: "noreply",
        subject: "Test — no-reply mailbox",
        html: emailLayout({
          heading: "No-reply test",
          bodyHtml: paragraph(
            "Machine mail with no reply path. If this arrived, the no-reply mailbox sends correctly.",
          ),
        }),
      };
    case "info":
    default:
      return residentNewNoticeEmail({
        body: "This is a test notice sent to check the general mailbox.",
        category: "General",
        hostelName: HOSTEL,
        noticesUrl: "https://example.test/resident/notices",
        title: "Test notice",
      });
  }
}

async function main() {
  const identity = await loadIdentityFromDatabase();

  setEmailIdentityResolver(() => identity);

  const categories = only ? [only] : EMAIL_CATEGORIES;

  console.log(`\nTo:        ${recipient}`);
  console.log(`Domain:    ${identity.domain}`);
  console.log(`Name:      ${identity.senderName || "(falls back to product name)"}`);
  console.log(
    `Reply-To:  ${identity.replyTo || `(derived — ${replyToFor("info", identity)})`}`,
  );
  console.log(`Resend key ${process.env.RESEND_API_KEY ? "present" : "MISSING"}`);
  console.log(`Mode:      ${dryRun ? "dry run — nothing will be sent" : "sending"}\n`);

  let failures = 0;

  for (const category of categories) {
    const content = sampleFor(category);
    const from = fromHeaderFor(category, identity);
    // Printed per category because it is not uniform: `noreply` carries none,
    // and getting this wrong is invisible until a reply bounces.
    const replyTo = replyToFor(category, identity) || "(no reply address)";

    if (dryRun) {
      console.log(`  ${category.padEnd(9)} from:     ${from}`);
      console.log(`  ${" ".repeat(9)} reply-to: ${replyTo}`);
      console.log(`  ${" ".repeat(9)} subject:  ${content.subject}\n`);
      continue;
    }

    // Sequential, not Promise.all: Resend rate-limits, and a partial failure is
    // far easier to read when the successes above it are already printed.
    const result = await sendEmail({ to: recipient!, ...content });

    if (result.sent) {
      console.log(`  ✓ ${category.padEnd(9)} ${from}`);
      console.log(`  ${" ".repeat(11)} reply-to: ${replyTo}`);
    } else {
      failures += 1;
      console.error(`  ✗ ${category.padEnd(9)} ${result.reason}`);
      console.error(`    ${result.detail ?? "(no detail)"}`);
    }
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  if (failures > 0) {
    console.error(`\n${failures} of ${categories.length} failed.\n`);
    process.exit(1);
  }

  console.log(dryRun ? "\nDry run complete.\n" : `\nAll ${categories.length} sent.\n`);
}

main().catch(async (error) => {
  console.error(error);

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  process.exit(1);
});
