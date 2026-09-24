import { ctaButton, emailLayout, escapeHtml, monthName, paragraph, type EmailContent } from "../layout";

export function paymentRejectedEmail(input: {
  hostelName: string;
  month: string;
  paymentsUrl: string;
  rejectionReason: string;
  residentName: string;
}): EmailContent {
  return {
    category: "billing",
    subject: `Please send your payment photo again — ${monthName(input.month)} · ${input.hostelName}`,
    html: emailLayout({
      heading: "Your payment photo was not accepted",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, ${escapeHtml(input.hostelName)} could not check your payment photo for <strong>${escapeHtml(monthName(input.month))}</strong>.`,
        ),
        paragraph(`Reason: <strong>${escapeHtml(input.rejectionReason)}</strong>`),
        paragraph(
          "Please send a correct photo again from your dashboard.",
        ),
        ctaButton(input.paymentsUrl, "Send photo again"),
      ].join("\n"),
    }),
  };
}
