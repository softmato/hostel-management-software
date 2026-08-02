import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/** EMAIL_SYSTEM.md §6.2 — the provider's directory listing is live. */
export function serviceProviderApprovedEmail(input: {
  category: string;
  directoryUrl: string;
  fullName: string;
}): EmailContent {
  return {
    subject: "Your service provider listing is approved",
    html: emailLayout({
      heading: "You are listed",
      bodyHtml: [
        paragraph(`Hi ${escapeHtml(input.fullName)},`),
        paragraph(
          `Your <strong>${escapeHtml(input.category)}</strong> listing has been approved. Hostels searching your category and area can now find you and contact you directly.`,
        ),
        paragraph(
          "Hostels will call you about jobs. HostelHub never shares resident personal details with providers — you only receive the details of the job itself.",
        ),
        ctaButton(input.directoryUrl, "View the directory"),
      ].join("\n"),
    }),
  };
}
