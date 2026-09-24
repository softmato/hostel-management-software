import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
import { PLATFORM_NAME } from "../../../brand/brand";

export function credentialsIssuedEmail(input: {
  roleLabel: string;
  email: string;
  temporaryPassword: string;
  loginUrl: string;
}): EmailContent {
  return {
    category: "security",
    subject: `Your ${PLATFORM_NAME} login details`,
    html: emailLayout({
      heading: "Your account is ready",
      bodyHtml: [
        paragraph(
          `We made a ${PLATFORM_NAME} account for you as <strong>${escapeHtml(input.roleLabel)}</strong>.`,
        ),
        paragraph(
          `Email: <strong>${escapeHtml(input.email)}</strong><br/>Temporary password: <strong>${escapeHtml(input.temporaryPassword)}</strong>`,
        ),
        paragraph(
          "When you first log in, you will set a new password. Do not share this password with anyone.",
        ),
        ctaButton(input.loginUrl, "Log in"),
      ].join("\n"),
    }),
  };
}
