import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
import { PLATFORM_NAME } from "../../../brand/brand";

export function hostelUnpublishedEmail(input: {
  hostelName: string;
  loginUrl: string;
  reason: string;
}): EmailContent {
  return {
    category: "info",
    subject: `Your hostel is hidden from search — ${input.hostelName}`,
    html: emailLayout({
      heading: "Your hostel is hidden",
      bodyHtml: [
        paragraph(
          `The ${PLATFORM_NAME} team has hidden <strong>${escapeHtml(input.hostelName)}</strong> from search.`,
        ),
        paragraph(`Reason: ${escapeHtml(input.reason)}`),
        paragraph(
          "Your hostel data is safe. Only the public page is hidden. Fix the problem above, then reply to this email and we will check again.",
        ),
        ctaButton(input.loginUrl, "Go to your dashboard"),
      ].join("\n"),
    }),
  };
}
