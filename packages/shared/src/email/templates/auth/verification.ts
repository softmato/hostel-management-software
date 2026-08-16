import { ctaButton, emailLayout, paragraph, type EmailContent } from "../layout";

export function verificationEmail(input: {
  verifyUrl: string;
  expiresInHours: number;
}): EmailContent {
  return {
    category: "security",
    subject: "Verify your email address",
    html: emailLayout({
      heading: "Verify your email",
      bodyHtml: [
        paragraph("Welcome to HostelHub! Confirm your email address to activate your account."),
        ctaButton(input.verifyUrl, "Verify email"),
        paragraph(
          `This link expires in ${input.expiresInHours} hours. If it has expired, request a new verification email from the login page.`,
        ),
      ].join("\n"),
    }),
  };
}
