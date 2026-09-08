import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/**
 * Sent when a superadmin invites somebody onto the platform admin roster.
 *
 * No password is minted and none is sent — the sibling `credentialsIssued`
 * mail does that, for the older path where the account is created up front.
 * Here the link *is* the credential: opening it proves the mailbox is theirs,
 * which is the whole reason a platform role may be granted through it, and the
 * recipient signs in with Google on the same address afterwards.
 *
 * The grade being granted is named in the subject and again in the body,
 * because "you have been made a superadmin" and "you have been made a
 * moderator" are very different messages to receive and the recipient should
 * not have to accept one to find out which it was.
 */
export function platformAdminInvitationEmail(input: {
  acceptUrl: string;
  expiresInDays: number;
  invitedByName: string;
  roleLabel: string;
  siteName?: string;
}): EmailContent {
  const isSuperadmin = input.roleLabel.toLowerCase().includes("superadmin");

  return {
    category: "security",
    subject: `${input.roleLabel} access — accept your invitation`,
    html: emailLayout({
      heading: "You have been invited to the platform team",
      siteName: input.siteName,
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(input.invitedByName)}</strong> has invited you to join the platform team as a <strong>${escapeHtml(input.roleLabel)}</strong>.`,
        ),
        paragraph(
          isSuperadmin
            ? "A superadmin can see and change everything on the platform — every hostel, every payment, the public website, and who else holds admin access."
            : "A platform moderator handles approvals, verification and moderation, and can read the reports. They cannot reach website configuration, fee plans, settings or the admin roster.",
        ),
        paragraph(
          "Opening the link below is what grants the access — it was sent only to this address, so opening it is how we know the mailbox is yours. There is nothing to fill in and no password to set: confirm on the page it opens, then sign in with Google using this same address.",
        ),
        ctaButton(input.acceptUrl, "Accept the invitation"),
        paragraph(
          `<span style="color:#64748b;font-size:13px;">The link works once and expires in ${input.expiresInDays} day(s). If you were not expecting this, ignore it — nothing changes until the link is opened, and you can ask the sender to withdraw it.</span>`,
        ),
      ].join("\n"),
    }),
  };
}
