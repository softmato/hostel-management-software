import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/**
 * EMAIL_SYSTEM.md §2.4 — a public visitor submitted an inquiry for a hostel.
 *
 * Sent to the hostel's admins. Until this existed a public inquiry created an
 * `Inquiry` row and told nobody, so it sat in the inbox until someone happened
 * to look.
 */
export function hostelInquiryReceivedEmail(input: {
  dashboardUrl: string;
  hostelName: string;
  message?: string;
  preferredVisitDate?: string;
  visitorEmail?: string;
  visitorName: string;
  visitorPhone?: string;
}): EmailContent {
  const details = [
    `<strong>Name:</strong> ${escapeHtml(input.visitorName)}`,
    input.visitorPhone ? `<strong>Phone:</strong> ${escapeHtml(input.visitorPhone)}` : null,
    input.visitorEmail ? `<strong>Email:</strong> ${escapeHtml(input.visitorEmail)}` : null,
    input.preferredVisitDate
      ? `<strong>Preferred visit:</strong> ${escapeHtml(input.preferredVisitDate)}`
      : null,
  ].filter(Boolean) as string[];

  return {
    category: "support",
    subject: `Someone wants to know about ${input.hostelName}`,
    html: emailLayout({
      heading: "New question about your hostel",
      bodyHtml: [
        paragraph(
          `Someone asked about <strong>${escapeHtml(input.hostelName)}</strong> from your hostel page.`,
        ),
        paragraph(details.join("<br/>")),
        input.message
          ? paragraph(`<strong>Message:</strong><br/>${escapeHtml(input.message)}`)
          : "",
        paragraph(
          "Please call or message them yourself.",
        ),
        ctaButton(input.dashboardUrl, "See all questions"),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
