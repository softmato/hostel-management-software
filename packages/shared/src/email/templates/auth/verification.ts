import { ctaButton, emailLayout, paragraph, type EmailContent } from "../layout";
import { PLATFORM_NAME } from "../../../brand/brand";

export function verificationEmail(input: {
  verifyUrl: string;
  expiresInHours: number;
}): EmailContent {
  return {
    category: "security",
    subject: "Please check your email",
    html: emailLayout({
      heading: "Check your email",
      bodyHtml: [
        paragraph(`Welcome to ${PLATFORM_NAME}! Tap the button to start your account.`),
        ctaButton(input.verifyUrl, "Yes, this is my email"),
        paragraph(
          `This link works for ${input.expiresInHours} hours. If it stops working, ask for a new one on the login page.`,
        ),
      ].join("\n"),
    }),
  };
}
