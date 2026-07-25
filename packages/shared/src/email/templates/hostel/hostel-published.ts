import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

export function hostelPublishedEmail(input: {
  hostelName: string;
  listingUrl: string;
}): EmailContent {
  return {
    subject: `Your hostel is now live — ${input.hostelName}`,
    html: emailLayout({
      heading: "Your listing is live 🎉",
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(input.hostelName)}</strong> is now published on HostelHub and visible to students searching for a place to stay.`,
        ),
        paragraph(
          "Keep your photos, pricing and vacancy details up to date from your dashboard — listings with current information get more inquiries.",
        ),
        ctaButton(input.listingUrl, "View your listing"),
      ].join("\n"),
    }),
  };
}
