import {
  ctaButton,
  emailLayout,
  escapeHtml,
  paragraph,
  type EmailContent,
} from "../layout";

/**
 * A hostel owner asking to close their account. It is not self-service: their
 * hostel's residents, payments and staff hang off that account, so the request
 * is routed to the platform owner to act on rather than executed.
 */
export function accountDeletionReviewEmail(input: {
  hostelNames: string[];
  queueUrl: string;
  reason: string;
  requesterEmail: string;
  requesterName?: string;
  requesterRole: string;
}): EmailContent {
  const who = input.requesterName
    ? `${escapeHtml(input.requesterName)} (${escapeHtml(input.requesterEmail)})`
    : escapeHtml(input.requesterEmail);

  return {
    category: "alert",
    subject: `Account deletion request from ${input.requesterName ?? input.requesterEmail}`,
    html: emailLayout({
      heading: "Someone wants to delete their account",
      bodyHtml: [
        paragraph(
          `${who} — <strong>${escapeHtml(input.requesterRole)}</strong> — has asked for their account to be deleted.`,
        ),
        input.hostelNames.length > 0
          ? paragraph(
              `Hostels on this account: <strong>${escapeHtml(input.hostelNames.join(", "))}</strong>. If you delete it first, these hostels will have no admin.`,
            )
          : paragraph("No hostels are on this account."),
        paragraph(`Their reason: “${escapeHtml(input.reason)}”`),
        paragraph(
          "Nothing has changed yet. They can still log in until you say yes.",
        ),
        ctaButton(input.queueUrl, "Check request"),
      ].join("\n"),
    }),
  };
}
