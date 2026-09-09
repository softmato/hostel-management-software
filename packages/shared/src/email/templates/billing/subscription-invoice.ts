import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/** Whole rupees with thousands separators — `4900` reads as `Rs 4,900`. */
export function formatRupees(amount: number) {
  return `Rs ${amount.toLocaleString("en-IN")}`;
}

/**
 * The invoice for a hostel's plan.
 *
 * `documentUrl` is optional and is **omitted rather than faked** while the
 * parent company's document SDK is still being wired. An email that offers a
 * download button pointing at nothing is worse than one that states the amount
 * and the reference plainly — so with no URL the figures carry the message, and
 * the button simply does not appear.
 */
export function subscriptionInvoiceEmail(input: {
  amount: number;
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
        ...(input.documentUrl
          ? [paragraph(`A PDF copy is attached to your account: ${escapeHtml(input.documentUrl)}`)]
          : []),
      ].join("\n"),
    }),
  };
}
