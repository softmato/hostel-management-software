import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

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
 * send), the figures carry the message and the billing page is offered instead.
 */
export function subscriptionInvoiceEmail(input: {
  amount: number;
  /** The invoice PDF is on this email. */
  attached?: boolean;
  cycleLabel: string;
  documentUrl?: string | null;
  dueAt?: string | null;
  hostelName: string;
  invoiceNumber: string;
  ownerName?: string;
  payUrl: string;
  planName: string;
}): EmailContent {
  const greeting = input.ownerName ? `Hi ${escapeHtml(input.ownerName)},` : "Hi,";

  return {
    category: "billing",
    subject: `Invoice ${input.invoiceNumber} — ${input.planName} for ${input.hostelName}`,
    html: emailLayout({
      heading: "Your plan invoice",
      bodyHtml: [
        paragraph(greeting),
        paragraph(
          `Here is the invoice for <strong>${escapeHtml(input.planName)}</strong> on <strong>${escapeHtml(input.hostelName)}</strong>.`,
        ),
        paragraph(
          [
            `Invoice: <strong>${escapeHtml(input.invoiceNumber)}</strong>`,
            `Plan: <strong>${escapeHtml(input.planName)}</strong> (${escapeHtml(input.cycleLabel)})`,
            `Amount: <strong>${formatRupees(input.amount)}</strong>`,
            input.dueAt ? `Due by: <strong>${escapeHtml(input.dueAt)}</strong>` : "",
          ]
            .filter(Boolean)
            .join("<br/>"),
        ),
        paragraph(
          "Your listing goes live the moment this is paid — activation is immediate, there is nothing further to wait for.",
        ),
        ctaButton(input.payUrl, "Pay now"),
        ...(input.attached
          ? [paragraph("The invoice is attached to this email as a PDF.")]
          : input.documentUrl
            ? [
                paragraph(
                  `You can download the invoice from your billing page: ${escapeHtml(input.documentUrl)}`,
                ),
              ]
            : []),
      ].join("\n"),
    }),
  };
}
