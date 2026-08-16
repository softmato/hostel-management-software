import {
  ctaButton,
  emailLayout,
  escapeHtml,
  paragraph,
  type EmailContent,
} from "../layout";

/** EMAIL_SYSTEM.md §9.2. */
export function accountDeletionCancelledEmail(input: {
  loginUrl: string;
  userName?: string;
}): EmailContent {
  return {
    category: "security",
    subject: "Your account has been reactivated",
    html: emailLayout({
      heading: "Your account is active again",
      bodyHtml: [
        paragraph(
          `${input.userName ? `${escapeHtml(input.userName)}, the` : "The"} deletion request on your HostelHub account has been cancelled. You can sign in again straight away.`,
        ),
        paragraph(
          "Nothing was deleted. Your profile, history and settings are exactly as you left them.",
        ),
        paragraph(
          "If it was not you who cancelled this, change your password immediately and contact your hostel.",
        ),
        ctaButton(input.loginUrl, "Sign in"),
      ].join("\n"),
    }),
  };
}
