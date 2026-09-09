import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/**
 * The email that turns *Pay now* on.
 *
 * The one the owner has been waiting for since they submitted: their documents
 * and details have been read by a person and accepted. It is deliberately
 * separate from `hostel-approved`, which hands over admin credentials — this
 * one has a single job, which is to say the wait is over and point at the
 * button that is now live.
 *
 * Two wordings, because the owner may already have chosen a plan while waiting
 * (the registration page lets them, on purpose). If they have, there is exactly
 * one thing left to do and the email says so; if they have not, the next step
 * is choosing.
 */
export function hostelVerifiedEmail(input: {
  hostelName: string;
  ownerName?: string;
  /** The plan they picked during the wait, if they picked one. */
  selectedPlanName?: string | null;
  statusUrl: string;
}): EmailContent {
  const greeting = input.ownerName ? `Hi ${escapeHtml(input.ownerName)},` : "Hi,";

  return {
    category: "info",
    subject: `Verified — ${input.hostelName} is ready to go live`,
    html: emailLayout({
      heading: "Your details are verified",
      bodyHtml: [
        paragraph(greeting),
        paragraph(
          `We have finished checking the details and documents for <strong>${escapeHtml(input.hostelName)}</strong>. Everything is in order.`,
        ),
        input.selectedPlanName
          ? paragraph(
              `You already chose <strong>${escapeHtml(input.selectedPlanName)}</strong> while you were waiting, so there is just one step left — pay for it, and your listing goes live immediately.`,
            )
          : paragraph(
              "The last step is choosing a plan. Pick the one that suits you, pay for it, and your listing goes live immediately.",
            ),
        ctaButton(
          input.statusUrl,
          input.selectedPlanName ? "Pay and go live" : "Choose your plan",
        ),
      ].join("\n"),
    }),
  };
}
