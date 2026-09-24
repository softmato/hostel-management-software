import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
import { PLATFORM_NAME } from "../../../brand/brand";

export function hostelApprovedEmail(input: {
  hostelName: string;
  loginUrl: string;
  /**
   * Present only when a brand-new account was created for the owner.
   * Existing accounts are upgraded in place and keep their credentials
   * (ARCHITECTURE.md §3.2).
   */
  credentials?: { email: string; temporaryPassword: string };
  /**
   * The hostel's single shared cook login, issued at approval (PHASES.md §3.1:
   * "Send cook credentials in same email as hostel admin approval").
   */
  cookCredentials?: { cookName: string; email: string; temporaryPassword: string };
}): EmailContent {
  const credentialsBlock = input.credentials
    ? [
        paragraph(
          `Email: <strong>${escapeHtml(input.credentials.email)}</strong><br/>Temporary password: <strong>${escapeHtml(input.credentials.temporaryPassword)}</strong>`,
        ),
        paragraph("When you first log in, you will set a new password."),
        paragraph(
          "Use Google? If this email is a Google account, just tap <strong>Continue with Google</strong> on the login page. No password needed.",
        ),
      ]
    : [
        paragraph(
          "Log in with the same account you used to register. It is now a hostel admin account.",
        ),
      ];

  const cookBlock = input.cookCredentials
    ? [
        `<hr style="margin:28px 0;border:none;border-top:1px solid #e2e8f0;" />`,
        `<p style="margin:0 0 12px;font-size:16px;font-weight:600;">Cook login</p>`,
        paragraph(
          `We made a kitchen login for <strong>${escapeHtml(input.cookCredentials.cookName)}</strong>. Give it to your cook. They can tell residents about meals from their phone.`,
        ),
        paragraph(
          `Login: <strong>${escapeHtml(input.cookCredentials.email)}</strong><br/>Password: <strong>${escapeHtml(input.cookCredentials.temporaryPassword)}</strong>`,
        ),
        paragraph(
          "The first cook to log in sets a new password. All cooks use that same password.",
        ),
        paragraph(
          "Keep it safe. Share it only with cooks. When a cook leaves, make a new password from your Food page. Cooks cannot see payments, complaints or resident details.",
        ),
      ]
    : [];

  return {
    category: "info",
    subject: `Good news! Your hostel is approved — ${input.hostelName}`,
    html: emailLayout({
      heading: "Hostel approved 🎉",
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(input.hostelName)}</strong> is approved. It is now on ${PLATFORM_NAME}.`,
        ),
        ...credentialsBlock,
        ctaButton(input.loginUrl, "Go to your dashboard"),
        ...cookBlock,
      ].join("\n"),
    }),
  };
}
