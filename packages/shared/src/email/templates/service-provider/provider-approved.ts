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
    subject: `You are approved on ${siteName}`,
    html: emailLayout({
      heading: "You are listed",
      siteName: input.siteName,
      bodyHtml: [
        paragraph(`Hi ${escapeHtml(input.fullName)},`),
        paragraph(
          `You are approved as <strong>${escapeHtml(input.category)}</strong>. Hostels in your area can now find you and call you.`,
        ),
        // The single most common support question at this point is "so how do I
        // get in?" — answered here rather than left to be guessed at. There are
        // no new credentials to issue: the account they registered with *is*
        // their provider account.
        paragraph(
          `Log in with the same Google account you used to register. No password needed. You will see a <strong>Jobs</strong> tab in the menu.`,
        ),
        ctaButton(input.jobsUrl, "Open my jobs"),
        paragraph(
          `Your ID card comes in another email. Show it when you go to a hostel.`,
        ),
        paragraph(
          `Hostels will call you for jobs. You only get the job details, not residents' personal details.`,
        ),
      ].join("\n"),
    }),
  };
}
