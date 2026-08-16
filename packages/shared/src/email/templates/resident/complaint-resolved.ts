import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

export function complaintResolvedEmail(input: {
  complaintsUrl: string;
  hostelName: string;
  response?: string;
  title: string;
}): EmailContent {
  return {
    category: "support",
    subject: `Complaint resolved: ${input.title} — ${input.hostelName}`,
    html: emailLayout({
      heading: "Complaint resolved",
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(input.hostelName)}</strong> marked your complaint <strong>${escapeHtml(input.title)}</strong> as resolved.`,
        ),
        input.response
          ? paragraph(`What they did: “${escapeHtml(input.response)}”`)
          : "",
        paragraph(
          "If the problem is genuinely fixed, confirm it from your portal so the hostel can close it out. If it is not, reopen the thread and tell them.",
        ),
        ctaButton(input.complaintsUrl, "Confirm the resolution"),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
