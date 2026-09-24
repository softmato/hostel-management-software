import {
  ctaButton,
  emailLayout,
  escapeHtml,
  paragraph,
  type EmailContent,
} from "../layout";
import { PLATFORM_NAME } from "../../../brand/brand";

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
    subject: "Your account will be deleted in 60 days",
    html: emailLayout({
      heading: "Your account will be deleted",
      bodyHtml: [
        paragraph(
          `${input.userName ? `${escapeHtml(input.userName)}, you` : "You"} asked us to delete your ${PLATFORM_NAME} account. Your account is now closed. You cannot log in.`,
        ),
        paragraph(
          `Nothing is deleted yet. We keep your data until <strong>${escapeHtml(input.scheduledDeletionDate)}</strong> (60 days). After that, it is deleted forever.`,
        ),
        paragraph(
          "We will delete: your account, your profile, your location and attendance history, and your devices. Your posts stay, but without your name.",
        ),
        paragraph(
          "We will keep: payment and receipt records, without your name. Hostels must keep these for their accounts.",
        ),
        paragraph(
          `<strong>Not you, or changed your mind? Cancel before ${escapeHtml(input.scheduledDeletionDate)}.</strong> Your account will come back as it was.`,
        ),
        ctaButton(input.cancelUrl, "Keep my account"),
      ].join("\n"),
    }),
  };
}
