import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
import { PLATFORM_NAME } from "../../../brand/brand";

/**
 * Sent to a cook's own mailbox when a hostel admin invites them by email.
 *
 * The counterpart to the generated-credential mail: that one goes to the
 * *admin* because there is no mailbox behind a generated login, this one goes
 * to the cook because there is. Accepting turns the recipient's own account
 * into the cook account — no password is minted here and none is sent.
 */
export function cookInvitationEmail(input: {
  acceptUrl: string;
  cookName: string;
  expiresInDays: number;
  hostelName: string;
}): EmailContent {
  return {
    category: "security",
    subject: `Cook access — ${input.hostelName}`,
    html: emailLayout({
      heading: "You have been invited to run the kitchen",
      bodyHtml: [
        paragraph(
          `Hello ${escapeHtml(input.cookName)}, <strong>${escapeHtml(input.hostelName)}</strong> has invited you to their kitchen on ${PLATFORM_NAME}.`,
        ),
        paragraph(
          "Accepting turns this email address into your cook sign-in. You will be able to tell residents that a meal is ready and post photos of what was served — and nothing else: the account cannot see resident records, money or complaints.",
        ),
        ctaButton(input.acceptUrl, "Accept the invitation"),
        paragraph(
          `The link works once and expires in ${input.expiresInDays} day(s). If it has run out, ask the hostel to send a fresh one.`,
        ),
      ].join("\n"),
    }),
  };
}
