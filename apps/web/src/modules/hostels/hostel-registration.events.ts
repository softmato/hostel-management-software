import { hostelRegisteredByTeamEmail } from "@hostel/shared/email/templates/hostel/hostel-registered-by-team";
import { hostelSubmissionReceivedEmail } from "@hostel/shared/email/templates/hostel/submission-received";
import { hostelVerifiedEmail } from "@hostel/shared/email/templates/hostel/hostel-verified";
import { subscriptionInvoiceEmail } from "@hostel/shared/email/templates/billing/subscription-invoice";
import { subscriptionReceiptEmail } from "@hostel/shared/email/templates/billing/subscription-receipt";
import { sendEmail } from "@hostel/shared/email/sender";
import type { EmailContent } from "@hostel/shared/email/templates/layout";

/**
 * Every email the registration lifecycle sends, in one file.
 *
 * ## Why this exists
 *
 * The side effects of "somebody submitted a hostel" were spread through the
 * service that wrote the rows: an email here, a platform notification there, a
 * status change somewhere else. With one desk that was survivable. With two —
 * a public owner and a field agent posting the same shape at different times,
 * one of which publishes immediately — it is not, because the only way to know
 * what an owner is actually told is to read both call paths and hold them in
 * your head at once.
 *
 * So each moment in the lifecycle is a function here, and both desks call the
 * same ones. What changes between them is *which* moments occur, never what a
 * given moment says.
 *
 * ## The moments
 *
 * | | public | team |
 * |---|---|---|
 * | `submitted` | "we'll verify, 1–2 business days" | — |
 * | `registeredByTeam` | — | "you're live", plus any due |
 * | `verified` | "pay now is on" | — (never queues) |
 * | `invoiceIssued` | on *Pay now* | when the agent passes the plan step |
 * | `paymentSettled` | receipt | receipt, with the balance if any |
 *
 * ## Nothing here may throw
 *
 * Delivery failure must never fail the business flow behind it — a hostel that
 * registered successfully has registered successfully whether or not Resend was
 * reachable. `sendEmail` already swallows its own errors and reports them in
 * the result; these wrappers add the logging so a silent non-delivery is at
 * least visible in the logs.
 */

function appBase() {
  return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** The owner's progress page. The same URL at every stage — it is one page. */
export function registrationStatusUrl() {
  return `${appBase()}/register-hostel/form`;
}

export function hostelListingUrl(slug: string) {
  return `${appBase()}/hostels/${slug}`;
}

/** Dates in emails are read by people, not parsed. */
export function formatEmailDate(value?: Date | string | null) {
  if (!value) {
    return null;
  }

  const date = typeof value === "string" ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function deliver(action: string, to: string, message: EmailContent) {
  if (!to) {
    return;
  }

  const result = await sendEmail({
    category: message.category,
    html: message.html,
    subject: message.subject,
    to,
  });

  if (!result.sent) {
    console.warn(
      JSON.stringify({ action: `${action}_email_failed`, level: "warn", reason: result.reason, to }),
    );
  }
}

/* ── Public: submitted, and now waiting ────────────────────────────────── */

/**
 * "We have your details; we will verify them."
 *
 * Only the public desk sends this. A team registration is already published by
 * the time anything is sent, so telling that owner to expect a review would be
 * describing a queue they are not in.
 */
export async function onRegistrationSubmitted(input: {
  hostelName: string;
  ownerEmail?: string;
  ownerName?: string;
}) {
  if (!input.ownerEmail) {
    return;
  }

  await deliver(
    "hostel_submission_received",
    input.ownerEmail,
    hostelSubmissionReceivedEmail({
      hostelName: input.hostelName,
      ownerName: input.ownerName,
    }),
  );
}

/* ── Team: registered and live in one step ─────────────────────────────── */

export async function onRegisteredByTeam(input: {
  agentName?: string;
  amountPaid: number;
  dueBy?: Date | null;
  hostelName: string;
  hostelSlug: string;
  outstanding: number;
  ownerEmail?: string;
  ownerName?: string;
  planName: string;
}) {
  if (!input.ownerEmail) {
    return;
  }

  await deliver(
    "hostel_registered_by_team",
    input.ownerEmail,
    hostelRegisteredByTeamEmail({
      agentName: input.agentName,
      amountPaid: input.amountPaid,
      dueBy: formatEmailDate(input.dueBy),
      hostelName: input.hostelName,
      listingUrl: hostelListingUrl(input.hostelSlug),
      outstanding: input.outstanding,
      ownerName: input.ownerName,
      planName: input.planName,
    }),
  );
}

/* ── Public: verification landed ───────────────────────────────────────── */

/**
 * "Your details are verified" — the email that turns *Pay now* on.
 *
 * Takes the plan they may have chosen during the wait, so the message can name
 * the single remaining step rather than sending them back to a chooser they
 * already used.
 */
export async function onHostelVerified(input: {
  hostelName: string;
  ownerEmail?: string;
  ownerName?: string;
  selectedPlanName?: string | null;
}) {
  if (!input.ownerEmail) {
    return;
  }

  await deliver(
    "hostel_verified",
    input.ownerEmail,
    hostelVerifiedEmail({
      hostelName: input.hostelName,
      ownerName: input.ownerName,
      selectedPlanName: input.selectedPlanName,
      statusUrl: registrationStatusUrl(),
    }),
  );
}

/* ── Both: invoice raised ──────────────────────────────────────────────── */

export async function onInvoiceIssued(input: {
  amount: number;
  cycleLabel: string;
  documentUrl?: string | null;
  dueAt?: Date | null;
  hostelName: string;
  invoiceNumber: string;
  ownerEmail?: string;
  ownerName?: string;
  planName: string;
}) {
  if (!input.ownerEmail) {
    return;
  }

  await deliver(
    "subscription_invoice_issued",
    input.ownerEmail,
    subscriptionInvoiceEmail({
      amount: input.amount,
      cycleLabel: input.cycleLabel,
      documentUrl: input.documentUrl,
      dueAt: formatEmailDate(input.dueAt),
      hostelName: input.hostelName,
      invoiceNumber: input.invoiceNumber,
      ownerName: input.ownerName,
      payUrl: registrationStatusUrl(),
      planName: input.planName,
    }),
  );
}

/* ── Both: money landed ────────────────────────────────────────────────── */

export async function onPaymentSettled(input: {
  amount: number;
  dueBy?: Date | null;
  hostelName: string;
  invoiceNumber: string;
  method: string;
  outstanding: number;
  ownerEmail?: string;
  planName: string;
  receiptNumber: string;
}) {
  if (!input.ownerEmail) {
    return;
  }

  await deliver(
    "subscription_receipt",
    input.ownerEmail,
    subscriptionReceiptEmail({
      amount: input.amount,
      dueBy: formatEmailDate(input.dueBy),
      hostelName: input.hostelName,
      invoiceNumber: input.invoiceNumber,
      method: input.method,
      outstanding: input.outstanding,
      planName: input.planName,
      receiptNumber: input.receiptNumber,
    }),
  );
}
