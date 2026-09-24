import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
import { PLATFORM_NAME } from "../../../brand/brand";

export function hostelSubmissionReceivedEmail(input: {
  hostelName: string;
  ownerName?: string;
}): EmailContent {
  const greeting = input.ownerName ? `Hi ${escapeHtml(input.ownerName)},` : "Hi,";

  return {
    category: "info",
    subject: `We got your hostel details — ${input.hostelName}`,
    html: emailLayout({
      heading: "We got your details",
      bodyHtml: [
        paragraph(greeting),
        paragraph(
          `Thank you for adding <strong>${escapeHtml(input.hostelName)}</strong> to ${PLATFORM_NAME}. We will check your details and documents soon.`,
        ),
        paragraph(
          "We will email you when your hostel is approved, or if we need anything more.",
        ),
      ].join("\n"),
    }),
  };
}
