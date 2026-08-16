import {
  ctaButton,
  emailLayout,
  escapeHtml,
  paragraph,
  type EmailContent,
} from "../layout";

/**
 * EMAIL_SYSTEM.md §9.1. The cancel link is the whole point of this mail: the
 * account is already suspended, so the recipient cannot log in to change their
 * mind. The link carries a signed, single-purpose token instead.
 */
export function accountDeletionRequestedEmail(input: {
  cancelUrl: string;
  scheduledDeletionDate: string;
  userName?: string;
}): EmailContent {
  return {
    category: "security",
    subject: "Account deletion requested — 60 days to cancel",
    html: emailLayout({
      heading: "Account deletion requested",
      bodyHtml: [
        paragraph(
          `${input.userName ? `${escapeHtml(input.userName)}, we` : "We"} received a request to delete your HostelHub account. Your account is now closed and you will not be able to sign in.`,
        ),
        paragraph(
          `Nothing is erased yet. Your data is held until <strong>${escapeHtml(input.scheduledDeletionDate)}</strong> — 60 days — and permanently deleted after that.`,
        ),
        paragraph(
          "What will be deleted: your account and profile, your location and attendance history, your devices, and your consent records. Your community posts stay up but stop being linked to you.",
        ),
        paragraph(
          "What will be kept: payment and receipt records with your name removed, and audit entries. Hostels are required to keep those for their own accounts.",
        ),
        paragraph(
          `<strong>If you did not ask for this, or you have changed your mind, cancel before ${escapeHtml(input.scheduledDeletionDate)}.</strong> Cancelling restores the account exactly as it was.`,
        ),
        ctaButton(input.cancelUrl, "Cancel deletion and restore my account"),
      ].join("\n"),
    }),
  };
}
