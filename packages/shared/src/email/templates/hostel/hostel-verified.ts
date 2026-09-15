import {
  ctaButton,
  detailsTable,
  emailLayout,
  escapeHtml,
  paragraph,
  smallPrint,
  type EmailContent,
} from "../layout";

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
 *
 * For a public registration the portal is **not** open yet — it opens with the
 * payment — and the email says so plainly. An owner who registered without an
 * account also gets a temporary password here: paying happens behind a sign-in,
 * and without one they would have no way to reach the button this email is
 * about.
 */
export function hostelVerifiedEmail(input: {
  /**
   * A way to sign in, for an owner who registered without an account and so
   * had none. It opens their public account — enough to pay — not the portal.
   */
  credentials?: { email: string; temporaryPassword: string } | null;
  hostelName: string;
  ownerName?: string;
  /** A public registration: the hostel portal opens with the payment, not before. */
  portalOpensOnPayment?: boolean;
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
        input.portalOpensOnPayment
          ? paragraph(
              "Your hostel portal opens as soon as the payment is complete. We will email you the moment it does.",
            )
          : "",
        input.credentials
          ? [
              paragraph("Sign in with these details to pay:"),
              detailsTable([
                { label: "Email", value: input.credentials.email },
                { label: "Temporary password", value: input.credentials.temporaryPassword },
              ]),
              smallPrint("You will be asked to choose your own password after you sign in."),
            ].join("\n")
          : "",
        ctaButton(
          input.statusUrl,
          input.selectedPlanName ? "Pay and go live" : "Choose your plan",
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
