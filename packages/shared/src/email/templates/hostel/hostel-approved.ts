import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

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
        paragraph("You will be asked to set a new password on first login."),
        paragraph(
          "Prefer Google? If this address is a Google account, you can simply click <strong>Continue with Google</strong> on the login page and skip the password entirely — it signs you into the same hostel admin account.",
        ),
      ]
    : [
        paragraph(
          "Log in with the account you registered with — it has been upgraded to hostel admin access.",
        ),
      ];

  const cookBlock = input.cookCredentials
    ? [
        `<hr style="margin:28px 0;border:none;border-top:1px solid #e2e8f0;" />`,
        `<p style="margin:0 0 12px;font-size:16px;font-weight:600;">Cook portal access</p>`,
        paragraph(
          `We created a shared kitchen login for <strong>${escapeHtml(input.cookCredentials.cookName)}</strong>. Give it to whoever is cooking — they can announce meals to residents from their phone.`,
        ),
        paragraph(
          `Login: <strong>${escapeHtml(input.cookCredentials.email)}</strong><br/>First-time password: <strong>${escapeHtml(input.cookCredentials.temporaryPassword)}</strong>`,
        ),
        paragraph(
          "The first cook to sign in will be asked to choose a new password — that becomes the kitchen's shared password, and any other cook signs in with it too.",
        ),
        paragraph(
          "Treat it like a key: share it only with cooking staff, and rotate it from your Food page whenever someone leaves. It can only announce meals — it cannot see payments, complaints, or resident contact details.",
        ),
      ]
    : [];

  return {
    subject: `Your hostel is approved — ${input.hostelName}`,
    html: emailLayout({
      heading: "Hostel approved 🎉",
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(input.hostelName)}</strong> has been approved and is now part of HostelHub.`,
        ),
        ...credentialsBlock,
        ctaButton(input.loginUrl, "Go to your dashboard"),
        ...cookBlock,
      ].join("\n"),
    }),
  };
}
