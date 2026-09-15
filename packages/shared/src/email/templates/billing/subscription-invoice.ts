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

/** Whole rupees with thousands separators — `4900` reads as `Rs 4,900`. */
export function formatRupees(amount: number) {
  return `Rs ${amount.toLocaleString("en-IN")}`;
}

/**
 * The invoice for a hostel's plan.
 *
 * The PDF rides on the email — the same document the billing screen downloads —
 * and `attached` says whether it made it, so the body never promises paperwork
 * that is not there. When it did not (a renderer failure, which never blocks the
 * send), the figures carry the message and a download link is offered instead.
 *
 * ## The action is the caller's
 *
 * It depends on who is paying and how, which only the call site knows. An owner
 * who asked for this by tapping *Pay now* gets that button back. A field-team
 * registration gets *View billing*: the agent is collecting in person as this
 * arrives, and a second way to pay the same money is how it gets paid twice.
 */
export function subscriptionInvoiceEmail(input: {
  action: { label: string; url: string };
  amount: number;
  /** The invoice PDF is on this email. */
  attached?: boolean;
  cycleLabel: string;
  documentUrl?: string | null;
  dueAt?: string | null;
  /** The listing is waiting on this payment, so say that paying publishes it. */
  goesLiveOnPayment?: boolean;
  hostelName: string;
  invoiceNumber: string;
  ownerName?: string;
  planName: string;
}): EmailContent {
  return {
    category: "billing",
    subject: `Invoice ${input.invoiceNumber} — ${input.planName} for ${input.hostelName}`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.ownerName),
        paragraph(
          `Here is your invoice for <strong>${escapeHtml(input.planName)}</strong> on <strong>${escapeHtml(input.hostelName)}</strong>.`,
        ),
        detailsTable([
          { emphasis: true, label: "Amount", value: formatRupees(input.amount) },
          { label: "Plan", value: `${input.planName} · ${input.cycleLabel}` },
          { label: "Invoice", value: input.invoiceNumber },
          { label: "Due date", value: input.dueAt ?? "" },
        ]),
        ctaButton(input.action.url, input.action.label),
        input.goesLiveOnPayment
          ? smallPrint("Your listing goes live as soon as this is paid.")
          : "",
        input.attached
          ? smallPrint("The invoice is attached to this email as a PDF.")
          : input.documentUrl
            ? smallPrint(`${textLink(input.documentUrl, "Download the invoice")} as a PDF.`)
            : "",
      ]
        .filter(Boolean)
        .join("\n"),
      eyebrow: "Invoice",
      heading: "Your plan invoice",
      preheader: `${formatRupees(input.amount)} for ${input.planName}${input.dueAt ? `, due ${input.dueAt}` : ""}.`,
    }),
  };
}
