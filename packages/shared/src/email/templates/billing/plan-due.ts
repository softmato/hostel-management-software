import { PLATFORM_NAME } from "../../../brand/brand";
import {
  ctaButton,
  detailsTable,
  emailLayout,
  escapeHtml,
  greeting,
  paragraph,
  smallPrint,
  textLink,
  type EmailContent,
} from "../layout";
import { formatRupees } from "./subscription-invoice";

/**
 * The two reminders about a plan payment that has not arrived: shortly before
 * it is due, and once it is late. `plan-due-reminders.service.ts` decides when;
 * these decide what is said. Both say to pay on the website and carry the link,
 * because the app may not.
 *
 * Both are short on purpose. The owner already has the invoice, figures and
 * all, from the day it was raised, so a reminder only has to say which payment,
 * how much, by when — and put the button where their thumb is.
 */

type PlanDueInput = {
  amountDue: number;
  /** The invoice PDF made it onto the email. */
  attached?: boolean;
  /** Already formatted for reading — see `emailDate`. */
  dueDate: string;
  hostelName: string;
  invoiceNumber: string;
  ownerName?: string;
  payUrl: string;
  planName: string;
};

/** The app takes no plan payments, so the email is where the owner is sent to pay. */
function payOnWebsite(payUrl: string) {
  return smallPrint(`Please pay it on the ${PLATFORM_NAME} website: ${textLink(payUrl, payUrl)}`);
}

const ATTACHED = smallPrint("The invoice is attached to this email as a PDF.");

const ALREADY_PAID =
  "Already paid? Send us the payment proof from your billing page and we will confirm it.";

/** `today`, `tomorrow`, `in 3 days` — counted in Nepal calendar days. */
function dueWhen(daysUntilDue: number) {
  if (daysUntilDue <= 0) {
    return "today";
  }

  return daysUntilDue === 1 ? "tomorrow" : `in ${daysUntilDue} days`;
}

export function planDueSoonEmail(
  input: PlanDueInput & {
    daysUntilDue: number;
    /**
     * Whether the listing is already up. One that is not — a self-registered
     * hostel that has not paid yet — is told that paying is what puts it live.
     */
    live: boolean;
  },
): EmailContent {
  const when = dueWhen(input.daysUntilDue);

  return {
    category: "billing",
    subject: `Payment due ${when} — ${input.planName} · ${input.hostelName}`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.ownerName),
        paragraph(
          `Your payment for <strong>${escapeHtml(input.planName)}</strong> on <strong>${escapeHtml(input.hostelName)}</strong> is due ${when}.`,
        ),
        detailsTable([
          { emphasis: true, label: "Amount due", value: formatRupees(input.amountDue) },
          { label: "Due date", value: input.dueDate },
          { label: "Invoice", value: input.invoiceNumber },
        ]),
        ctaButton(input.payUrl, "Pay now"),
        payOnWebsite(input.payUrl),
        input.attached ? ATTACHED : "",
        input.live ? "" : smallPrint("Your listing goes live as soon as this is paid."),
        smallPrint(ALREADY_PAID),
      ]
        .filter(Boolean)
        .join("\n"),
      eyebrow: "Payment reminder",
      heading: `Your plan payment is due ${when}`,
      preheader: `${formatRupees(input.amountDue)} for ${input.planName}, due ${input.dueDate}.`,
    }),
  };
}

/**
 * Sent each morning a live hostel is late and still owes. `alert`, like a resident's overdue fee (EMAIL_SYSTEM.md §0.2), and
 * red only in its label — the heading and the button stay calm, because the
 * owner is late on a bill, not in trouble.
 */
export function planOverdueEmail(input: PlanDueInput): EmailContent {
  return {
    category: "alert",
    subject: `Payment overdue — ${input.planName} · ${input.hostelName}`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.ownerName),
        paragraph(
          `Your payment for <strong>${escapeHtml(input.planName)}</strong> on <strong>${escapeHtml(input.hostelName)}</strong> is past its due date.`,
        ),
        detailsTable([
          { emphasis: true, label: "Amount due", value: formatRupees(input.amountDue) },
          { label: "Was due", value: input.dueDate },
          { label: "Invoice", value: input.invoiceNumber },
        ]),
        ctaButton(input.payUrl, "Pay now"),
        payOnWebsite(input.payUrl),
        input.attached ? ATTACHED : "",
        smallPrint(ALREADY_PAID),
      ]
        .filter(Boolean)
        .join("\n"),
      eyebrow: "Overdue",
      heading: "Your plan payment is overdue",
      preheader: `${formatRupees(input.amountDue)} for ${input.planName} was due ${input.dueDate}.`,
      urgent: true,
    }),
  };
}
