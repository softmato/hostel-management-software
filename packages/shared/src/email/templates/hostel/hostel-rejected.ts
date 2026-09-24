import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

export function hostelRejectedEmail(input: {
  hostelName: string;
  reason: string;
}): EmailContent {
  return {
    category: "info",
    subject: `Your hostel is not approved — ${input.hostelName}`,
    html: emailLayout({
      heading: "Not approved",
      bodyHtml: [
        paragraph(
          `We checked <strong>${escapeHtml(input.hostelName)}</strong>. We cannot approve it now.`,
        ),
        paragraph(`Reason: ${escapeHtml(input.reason)}`),
        paragraph(
          "You can fix your details and send again. Think we made a mistake? Reply to this email.",
        ),
      ].join("\n"),
    }),
  };
}
