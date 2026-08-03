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
    subject: `Account deletion request from ${input.requesterName ?? input.requesterEmail}`,
    html: emailLayout({
      heading: "Account deletion request needs review",
      bodyHtml: [
        paragraph(
          `${who} — <strong>${escapeHtml(input.requesterRole)}</strong> — has asked for their account to be deleted.`,
        ),
        input.hostelNames.length > 0
          ? paragraph(
              `Hostels attached to this account: <strong>${escapeHtml(input.hostelNames.join(", "))}</strong>. Deleting the account without handing these over would leave their residents, payments and staff without an administrator.`,
            )
          : paragraph("No hostels are currently attached to this account."),
        paragraph(`Their reason: “${escapeHtml(input.reason)}”`),
        paragraph(
          "Nothing has changed on the account. It stays active and they can still sign in until you approve the request.",
        ),
        ctaButton(input.queueUrl, "Review the request"),
      ].join("\n"),
    }),
  };
}
