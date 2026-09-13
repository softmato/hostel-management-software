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
    subject: `Your ${PLATFORM_NAME} account credentials`,
    html: emailLayout({
      heading: "Your account is ready",
      bodyHtml: [
        paragraph(
          `A ${PLATFORM_NAME} account has been created for you with the role <strong>${escapeHtml(input.roleLabel)}</strong>.`,
        ),
        paragraph(
          `Email: <strong>${escapeHtml(input.email)}</strong><br/>Temporary password: <strong>${escapeHtml(input.temporaryPassword)}</strong>`,
        ),
        paragraph(
          "You will be asked to set a new password the first time you log in. Do not share this temporary password with anyone.",
        ),
        ctaButton(input.loginUrl, "Log in"),
      ].join("\n"),
    }),
  };
}
