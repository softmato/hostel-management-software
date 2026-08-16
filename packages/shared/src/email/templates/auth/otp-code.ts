import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/**
 * The signup one-time code (docs/EMAIL_SYSTEM.md §1.0).
 *
 * `siteName` is optional for the same reason it is on `emailLayout`: this is
 * called from the auth service, which sends the code before there is a session
 * or a request scope to hang a settings read on. Left out, the shell falls back
 * to the shipped product name — the sender identity on the envelope is still
 * the configured one, because that is resolved inside `sendEmail()`.
 */
export function otpCodeEmail(input: {
  code: string;
  expiresInMinutes?: number;
  siteName?: string;
}): EmailContent {
  const brand = input.siteName?.trim();
  const expiry =
    input.expiresInMinutes && input.expiresInMinutes > 0
      ? `This code expires in ${Math.round(input.expiresInMinutes)} minutes.`
      : "This code expires shortly.";

  return {
    category: "security",
    subject: brand ? `Your ${brand} verification code` : "Your verification code",
    html: emailLayout({
      heading: "Verification code",
      ...(brand ? { siteName: brand } : {}),
      bodyHtml: [
        paragraph(
          "Use this one-time code to verify your email and finish creating your account.",
        ),
        `<div style="margin:28px 0;text-align:center;">
          <span style="display:inline-block;border:1px dashed #14b8a6;border-radius:12px;background:#f0fdfa;padding:14px 24px;font-size:30px;font-weight:800;letter-spacing:8px;color:#0f766e;">${escapeHtml(input.code)}</span>
        </div>`,
        paragraph(
          `${escapeHtml(expiry)} If you did not request it, you can ignore this email.`,
        ),
      ].join("\n"),
    }),
  };
}
