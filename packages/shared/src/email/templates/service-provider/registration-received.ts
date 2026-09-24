import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
import { PLATFORM_NAME } from "../../../brand/brand";

/** EMAIL_SYSTEM.md §6.1 — a local service provider submitted a directory listing. */
export function serviceProviderRegistrationReceivedEmail(input: {
  category: string;
  fullName: string;
}): EmailContent {
  return {
    category: "info",
    subject: "We got your details",
    html: emailLayout({
      heading: "We got your details",
      bodyHtml: [
        paragraph(`Hi ${escapeHtml(input.fullName)},`),
        paragraph(
          `Thank you for joining as <strong>${escapeHtml(input.category)}</strong> on ${PLATFORM_NAME}. We will check your details and documents soon.`,
        ),
        paragraph(
          "We will email you when you are approved.",
        ),
      ].join("\n"),
    }),
  };
}
