import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/**
 * Sent to the hostel admin when a generated cook login is issued or rotated.
 *
 * It goes to the admin, not the cook, because a generated login has no mailbox
 * behind it — the address exists to be typed into a sign-in box, and the admin
 * is the person who hands it over.
 *
 * `rotated` changes the framing rather than the facts: a rotation's headline
 * news is that the *old* password stopped working, which is the thing a hostel
 * needs to know before the kitchen phone fails to sign in tomorrow morning.
 */
export function cookCredentialsEmail(input: {
  cookName: string;
  credentials: { email: string; temporaryPassword: string };
  hostelName: string;
  loginUrl: string;
  rotated?: boolean;
}): EmailContent {
  return {
    category: "security",
    subject: input.rotated
      ? `New cook password — ${input.hostelName}`
      : `Cook sign-in for ${input.cookName} — ${input.hostelName}`,
    html: emailLayout({
      heading: input.rotated ? "A new cook password" : "A cook sign-in is ready",
      bodyHtml: [
        paragraph(
          input.rotated
            ? `A fresh password has been issued for <strong>${escapeHtml(input.cookName)}</strong> at <strong>${escapeHtml(input.hostelName)}</strong>. The previous one no longer works.`
            : `A sign-in has been created for <strong>${escapeHtml(input.cookName)}</strong> at <strong>${escapeHtml(input.hostelName)}</strong>.`,
        ),
        paragraph(
          `Sign-in: <strong>${escapeHtml(input.credentials.email)}</strong><br/>First-time password: <strong>${escapeHtml(input.credentials.temporaryPassword)}</strong>`,
        ),
        paragraph(
          "Hand both to your cook. They will be asked to choose their own password the first time they sign in, and after that nobody — including you — can read it back; if it is lost, issue a new one from the Cooks screen.",
        ),
        paragraph(
          "This account can announce meals and post food photos. It cannot see resident records, payments or complaints.",
        ),
        ctaButton(input.loginUrl, "Open the sign-in page"),
      ].join("\n"),
    }),
  };
}
