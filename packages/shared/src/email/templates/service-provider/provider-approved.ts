import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/** EMAIL_SYSTEM.md §6.2 — the provider's directory listing is live. */
export function serviceProviderApprovedEmail(input: {
  category: string;
  fullName: string;
  /** Where their assigned work shows up on the website. */
  jobsUrl: string;
  siteName: string;
}): EmailContent {
  const siteName = escapeHtml(input.siteName);

  return {
    category: "info",
    subject: `Your ${siteName} service provider listing is approved`,
    html: emailLayout({
      heading: "You are listed",
      siteName: input.siteName,
      bodyHtml: [
        paragraph(`Hi ${escapeHtml(input.fullName)},`),
        paragraph(
          `Your <strong>${escapeHtml(input.category)}</strong> listing has been approved. Hostels searching your category and area can now find you and contact you directly.`,
        ),
        // The single most common support question at this point is "so how do I
        // get in?" — answered here rather than left to be guessed at. There are
        // no new credentials to issue: the account they registered with *is*
        // their provider account.
        paragraph(
          `Sign in with the same Google account you registered with — there is no separate password to set up. Your <strong>Jobs</strong> tab appears in the menu once you are signed in.`,
        ),
        ctaButton(input.jobsUrl, "Open my jobs"),
        paragraph(
          `Your ID card is attached to a separate email as a PNG. Show it when you arrive at a hostel.`,
        ),
        paragraph(
          `Hostels will call you about jobs. ${siteName} never shares resident personal details with providers — you only receive the details of the job itself.`,
        ),
      ].join("\n"),
    }),
  };
}
