import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/**
 * Sent the moment a resident is bound to a hostel and their existing account is
 * promoted to a resident login. Deliberately carries no credentials: the
 * account already belongs to them, so it keeps whatever password or Google
 * sign-in it had. Residents who have no account yet are not sent this — they go
 * through QR activation instead.
 */
export function residentLinkedEmail(input: {
  dashboardUrl: string;
  hostelName: string;
  residentName: string;
}): EmailContent {
  return {
    subject: `You are now a resident of ${input.hostelName}`,
    html: emailLayout({
      heading: "Welcome to your resident portal",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, <strong>${escapeHtml(input.hostelName)}</strong> has added you as a resident on HostelHub.`,
        ),
        paragraph(
          "Nothing to activate and no new password to remember — just sign in the way you always do, with the same email and password or with Google, and you will land straight on your resident dashboard.",
        ),
        ctaButton(input.dashboardUrl, "Open my dashboard"),
        paragraph(
          "From there you can see your rent and payments, your meals, notices from the hostel, and raise complaints.",
        ),
      ].join("\n"),
    }),
  };
}
