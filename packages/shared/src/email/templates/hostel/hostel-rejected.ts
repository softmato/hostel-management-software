import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

export function hostelRejectedEmail(input: {
  hostelName: string;
  reason: string;
}): EmailContent {
  return {
    category: "info",
    subject: `Update on your hostel registration — ${input.hostelName}`,
    html: emailLayout({
      heading: "Registration not approved",
      bodyHtml: [
        paragraph(
          `We reviewed your registration for <strong>${escapeHtml(input.hostelName)}</strong> and could not approve it at this time.`,
        ),
        paragraph(`Reason: ${escapeHtml(input.reason)}`),
        paragraph(
          "You can update your details and submit again. If you believe this is a mistake, reply to this email and our team will take another look.",
        ),
      ].join("\n"),
    }),
  };
}
