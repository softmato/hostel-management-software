import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/** EMAIL_SYSTEM.md §6.3 — the listing was not approved. */
export function serviceProviderRejectedEmail(input: {
  fullName: string;
  reason?: string;
}): EmailContent {
  return {
    category: "info",
    subject: "You are not approved yet",
    html: emailLayout({
      heading: "Not approved",
      bodyHtml: [
        paragraph(`Hi ${escapeHtml(input.fullName)},`),
        paragraph(
          "We cannot approve you right now.",
        ),
        input.reason
          ? paragraph(`<strong>Reason:</strong> ${escapeHtml(input.reason)}`)
          : "",
        paragraph(
          "You can register again with correct details or clearer documents.",
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
