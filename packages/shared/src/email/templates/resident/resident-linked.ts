import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
import { PLATFORM_NAME } from "../../../brand/brand";

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
    category: "info",
    subject: `You are now a resident of ${input.hostelName}`,
    html: emailLayout({
      heading: "Welcome to your hostel",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, <strong>${escapeHtml(input.hostelName)}</strong> added you as a resident on ${PLATFORM_NAME}.`,
        ),
        paragraph(
          "No new password needed. Log in the same way as before (email and password, or Google).",
        ),
        ctaButton(input.dashboardUrl, "Open my dashboard"),
        paragraph(
          "There you can see rent, payments, meals and notices, and send complaints.",
        ),
      ].join("\n"),
    }),
  };
}
