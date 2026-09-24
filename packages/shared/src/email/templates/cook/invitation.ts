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
    subject: `You are invited as cook — ${input.hostelName}`,
    html: emailLayout({
      heading: "You are invited as cook",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.cookName)}, <strong>${escapeHtml(input.hostelName)}</strong> wants you as their cook on ${PLATFORM_NAME}.`,
        ),
        paragraph(
          "You will log in with this email. You can tell residents when food is ready and post food photos. You cannot see residents, money or complaints.",
        ),
        ctaButton(input.acceptUrl, "Accept"),
        paragraph(
          `This link works one time, for ${input.expiresInDays} day(s). If it stops working, ask the hostel for a new one.`,
        ),
      ].join("\n"),
    }),
  };
}
