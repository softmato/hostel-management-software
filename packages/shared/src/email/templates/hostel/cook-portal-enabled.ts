import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

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
    subject: `Cook portal access — ${input.hostelName}`,
    html: emailLayout({
      heading: "Cook portal is ready",
      bodyHtml: [
        paragraph(
          `The dedicated cook portal for <strong>${escapeHtml(input.hostelName)}</strong> is enabled for <strong>${escapeHtml(input.cookName)}</strong>.`,
        ),
        paragraph(
          "Hand these credentials to your cook. The portal is designed for phones — meals can be announced to residents with one tap.",
        ),
        paragraph(
          `Login: <strong>${escapeHtml(input.credentials.email)}</strong><br/>First-time password: <strong>${escapeHtml(input.credentials.temporaryPassword)}</strong>`,
        ),
        paragraph(
          "The first cook to sign in will be asked to choose a new password — that becomes the kitchen's shared password, and any other cook signs in with it too. Rotating from your Food page issues a fresh first-time password and retires the old one.",
        ),
        ctaButton(input.loginUrl, "Open HostelHub login"),
      ].join("\n"),
    }),
  };
}
