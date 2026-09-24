import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

export function complaintResolvedEmail(input: {
  complaintsUrl: string;
  hostelName: string;
  response?: string;
  title: string;
}): EmailContent {
  return {
    category: "support",
    subject: `Your complaint is fixed: ${input.title} — ${input.hostelName}`,
    html: emailLayout({
      heading: "Your complaint is fixed",
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(input.hostelName)}</strong> says your complaint <strong>${escapeHtml(input.title)}</strong> is fixed.`,
        ),
        input.response
          ? paragraph(`What they did: “${escapeHtml(input.response)}”`)
          : "",
        paragraph(
          "Is it really fixed? Tap below to say yes. If not, open it again and tell them.",
        ),
        ctaButton(input.complaintsUrl, "Yes, it is fixed"),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
