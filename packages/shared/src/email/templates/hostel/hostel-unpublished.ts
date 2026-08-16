import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

export function hostelUnpublishedEmail(input: {
  hostelName: string;
  loginUrl: string;
  reason: string;
}): EmailContent {
  return {
    category: "info",
    subject: `Your listing has been unpublished — ${input.hostelName}`,
    html: emailLayout({
      heading: "Listing unpublished",
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(input.hostelName)}</strong> has been removed from public search results by the HostelHub team.`,
        ),
        paragraph(`Reason: ${escapeHtml(input.reason)}`),
        paragraph(
          "Your hostel and its data are unchanged — only the public listing is hidden. Once the issue above is resolved, reply to this email and our team will review it for republishing.",
        ),
        ctaButton(input.loginUrl, "Go to your dashboard"),
      ].join("\n"),
    }),
  };
}
