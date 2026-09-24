import { ctaButton, emailLayout, paragraph, type EmailContent } from "../layout";
import { PLATFORM_NAME } from "../../../brand/brand";

export function passwordResetEmail(input: {
  resetUrl: string;
  expiresInMinutes: number;
}): EmailContent {
  return {
    category: "security",
    subject: `Reset your ${PLATFORM_NAME} password`,
    html: emailLayout({
      heading: "Reset your password",
      bodyHtml: [
        paragraph(`Someone asked to reset the password for your ${PLATFORM_NAME} account.`),
        ctaButton(input.resetUrl, "Reset password"),
        paragraph(
          `This link works for ${input.expiresInMinutes} minutes. Did not ask for it? Ignore this email. Your password stays the same.`,
        ),
      ].join("\n"),
    }),
  };
}
