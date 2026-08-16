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
    subject: `Payment proof needs attention — ${monthName(input.month)} · ${input.hostelName}`,
    html: emailLayout({
      heading: "Payment proof was not accepted",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, ${escapeHtml(input.hostelName)} could not verify the payment proof you uploaded for <strong>${escapeHtml(monthName(input.month))}</strong>.`,
        ),
        paragraph(`Reason: <strong>${escapeHtml(input.rejectionReason)}</strong>`),
        paragraph(
          "You can upload a corrected proof for the same payment from your dashboard.",
        ),
        ctaButton(input.paymentsUrl, "Upload a new proof"),
      ].join("\n"),
    }),
  };
}
