import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/**
 * EMAIL_SYSTEM.md §7.1 — a hostel was submitted and is waiting for review.
 *
 * Sent to platform staff (superadmins and moderators). Until this existed only
 * the *owner* was emailed on submission, so a pending hostel was invisible
 * until someone opened the approval queue on their own initiative.
 */
export function newHostelPendingEmail(input: {
  city?: string;
  hostelName: string;
  ownerEmail?: string;
  ownerName?: string;
  queueUrl: string;
}): EmailContent {
  const details = [
    `<strong>Hostel:</strong> ${escapeHtml(input.hostelName)}`,
    input.city ? `<strong>City:</strong> ${escapeHtml(input.city)}` : null,
    input.ownerName ? `<strong>Owner:</strong> ${escapeHtml(input.ownerName)}` : null,
    input.ownerEmail ? `<strong>Email:</strong> ${escapeHtml(input.ownerEmail)}` : null,
  ].filter(Boolean) as string[];

  return {
    category: "info",
    subject: `New hostel to check — ${input.hostelName}`,
    html: emailLayout({
      heading: "New hostel to check",
      bodyHtml: [
        paragraph("A new hostel was added. It is waiting for approval."),
        paragraph(details.join("<br/>")),
        paragraph(
          "Check the documents first. When you approve, the owner gets admin access.",
        ),
        ctaButton(input.queueUrl, "Check hostel"),
      ].join("\n"),
    }),
  };
}
