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
      heading: input.rotated ? "New cook password" : "Cook login is ready",
      bodyHtml: [
        paragraph(
          input.rotated
            ? `Here is a new password for <strong>${escapeHtml(input.cookName)}</strong> at <strong>${escapeHtml(input.hostelName)}</strong>. The old one does not work now.`
            : `Here is the login for <strong>${escapeHtml(input.cookName)}</strong> at <strong>${escapeHtml(input.hostelName)}</strong>.`,
        ),
        paragraph(
          `Login: <strong>${escapeHtml(input.credentials.email)}</strong><br/>Password: <strong>${escapeHtml(input.credentials.temporaryPassword)}</strong>`,
        ),
        paragraph(
          "Give both to your cook. On first login, they will set their own password. Nobody can see it after that. If they forget it, make a new one from the Cooks screen.",
        ),
        paragraph(
          "The cook can only tell residents about meals and post food photos. They cannot see residents, payments or complaints.",
        ),
        ctaButton(input.loginUrl, "Log in"),
      ].join("\n"),
    }),
  };
}
