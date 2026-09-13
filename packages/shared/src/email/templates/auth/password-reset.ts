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
      heading: "Password reset",
      bodyHtml: [
        paragraph(`We received a request to reset the password for your ${PLATFORM_NAME} account.`),
        ctaButton(input.resetUrl, "Reset password"),
        paragraph(
          `This link expires in ${input.expiresInMinutes} minutes. If you did not request this, you can safely ignore this email — your password will not change.`,
        ),
      ].join("\n"),
    }),
  };
}
