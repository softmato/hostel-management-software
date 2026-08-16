import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

export function hostelSubmissionReceivedEmail(input: {
  hostelName: string;
  ownerName?: string;
}): EmailContent {
  const greeting = input.ownerName ? `Hi ${escapeHtml(input.ownerName)},` : "Hi,";

  return {
    category: "info",
    subject: `We received your hostel registration — ${input.hostelName}`,
    html: emailLayout({
      heading: "Registration received",
      bodyHtml: [
        paragraph(greeting),
        paragraph(
          `Thanks for registering <strong>${escapeHtml(input.hostelName)}</strong> on HostelHub. Our team will review your details and documents shortly.`,
        ),
        paragraph(
          "You will get another email as soon as your hostel is approved (with your admin access) or if we need anything else from you.",
        ),
      ].join("\n"),
    }),
  };
}
