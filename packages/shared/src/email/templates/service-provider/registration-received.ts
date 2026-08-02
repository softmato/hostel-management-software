import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/** EMAIL_SYSTEM.md §6.1 — a local service provider submitted a directory listing. */
export function serviceProviderRegistrationReceivedEmail(input: {
  category: string;
  fullName: string;
}): EmailContent {
  return {
    subject: "We received your service provider registration",
    html: emailLayout({
      heading: "Registration received",
      bodyHtml: [
        paragraph(`Hi ${escapeHtml(input.fullName)},`),
        paragraph(
          `Thanks for registering as a <strong>${escapeHtml(input.category)}</strong> on HostelHub. Our team will review your details and documents shortly.`,
        ),
        paragraph(
          "You will get another email once your listing is approved and hostels can find you.",
        ),
      ].join("\n"),
    }),
  };
}
