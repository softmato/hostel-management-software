import { ctaButton, detailsTable, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

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
  return {
    category: "support",
    subject: `Someone wants to know about ${input.hostelName}`,
    html: emailLayout({
      heading: "New question about your hostel",
      bodyHtml: [
        paragraph(`Someone asked about <strong>${escapeHtml(input.hostelName)}</strong>. Please call or message them.`),
        detailsTable([
          { label: "Name", value: input.visitorName },
          { label: "Phone", value: input.visitorPhone ?? "" },
          { label: "Email", value: input.visitorEmail ?? "" },
          { label: "Wants to visit", value: input.preferredVisitDate ?? "" },
        ]),
        input.message ? paragraph(`“${escapeHtml(input.message)}”`) : "",
        ctaButton(input.dashboardUrl, "See all questions"),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
