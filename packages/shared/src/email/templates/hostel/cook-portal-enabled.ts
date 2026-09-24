import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
import { PLATFORM_NAME } from "../../../brand/brand";

/**
 * Sent to the hostel admin — cook accounts use a generated address with no real
 * mailbox, so the credentials go to the person who enabled the portal.
 */
export function cookPortalEnabledEmail(input: {
  cookName: string;
  credentials: { email: string; temporaryPassword: string };
  hostelName: string;
  loginUrl: string;
}): EmailContent {
  return {
    category: "security",
    subject: `Cook login is ready — ${input.hostelName}`,
    html: emailLayout({
      heading: "Cook login is ready",
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(input.cookName)}</strong> can now log in as cook for <strong>${escapeHtml(input.hostelName)}</strong>.`,
        ),
        paragraph(
          "Give this login to your cook. It works on phones. They can tell residents about meals with one tap.",
        ),
        paragraph(
          `Login: <strong>${escapeHtml(input.credentials.email)}</strong><br/>Password: <strong>${escapeHtml(input.credentials.temporaryPassword)}</strong>`,
        ),
        paragraph(
          "The first cook to log in sets a new password. All cooks use that same password. You can make a new password from your Food page.",
        ),
        ctaButton(input.loginUrl, "Log in"),
      ].join("\n"),
    }),
  };
}
