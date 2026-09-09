import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
import { formatRupees } from "../billing/subscription-invoice";

/**
 * What an owner gets when our own field team registered them.
 *
 * There is no queue and no waiting in this one, because there was none: an
 * agent sat with them, checked the papers, and the listing went live on the
 * spot. So this email is a confirmation rather than an acknowledgement, and it
 * must not borrow the "we'll review this shortly" language of the public path —
 * the owner would be left waiting for a second email that is never coming.
 *
 * When money is still owed it says so in the same breath as the good news.
 * Burying a balance under a celebration is how a due goes unpaid until it
 * becomes a suspension nobody saw coming.
 */
export function hostelRegisteredByTeamEmail(input: {
  agentName?: string;
  amountPaid: number;
  dueBy?: string | null;
  hostelName: string;
  listingUrl: string;
  outstanding: number;
  ownerName?: string;
  planName: string;
}): EmailContent {
  const greeting = input.ownerName ? `Hi ${escapeHtml(input.ownerName)},` : "Hi,";
  const owes = input.outstanding > 0;

  return {
    category: "info",
    subject: `${input.hostelName} is live on HostelHub`,
    html: emailLayout({
      heading: "Your listing is live 🎉",
      bodyHtml: [
        paragraph(greeting),
        paragraph(
          input.agentName
            ? `<strong>${escapeHtml(input.agentName)}</strong> from our team registered <strong>${escapeHtml(input.hostelName)}</strong> with you, and it is already published and visible to students searching for a place to stay.`
            : `<strong>${escapeHtml(input.hostelName)}</strong> is registered, published, and visible to students searching for a place to stay.`,
        ),
        paragraph(
          [
            `Plan: <strong>${escapeHtml(input.planName)}</strong>`,
            input.amountPaid > 0
              ? `Paid today: <strong>${formatRupees(input.amountPaid)}</strong>`
              : "",
          ]
            .filter(Boolean)
            .join("<br/>"),
        ),
        ...(owes
          ? [
              paragraph(
                [
                  `<strong>Still to pay: ${formatRupees(input.outstanding)}</strong>`,
                  input.dueBy ? ` by <strong>${escapeHtml(input.dueBy)}</strong>` : "",
                  ". You can settle it from your dashboard whenever suits — your listing stays live in the meantime.",
                ].join(""),
              ),
            ]
          : [paragraph("Your plan is paid in full and active. Nothing further is due.")]),
        ctaButton(input.listingUrl, "View your listing"),
      ].join("\n"),
    }),
  };
}
