import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/** EMAIL_SYSTEM.md §6.3 — the listing was not approved. */
export function serviceProviderRejectedEmail(input: {
  fullName: string;
  reason?: string;
}): EmailContent {
  return {
    subject: "About your service provider registration",
    html: emailLayout({
      heading: "Registration not approved",
      bodyHtml: [
        paragraph(`Hi ${escapeHtml(input.fullName)},`),
        paragraph(
          "We were not able to approve your service provider listing at this time.",
        ),
        input.reason
          ? paragraph(`<strong>Reason:</strong> ${escapeHtml(input.reason)}`)
          : "",
        paragraph(
          "You are welcome to register again with corrected details or clearer documents.",
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
