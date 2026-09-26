import { ctaButton, detailsTable, emailLayout, paragraph, type EmailContent } from "../layout";

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
  return {
    category: "info",
    subject: `New hostel to check — ${input.hostelName}`,
    html: emailLayout({
      heading: "New hostel to check",
      bodyHtml: [
        paragraph("A new hostel is waiting for approval. Check the documents first."),
        detailsTable([
          { label: "Hostel", value: input.hostelName },
          { label: "City", value: input.city ?? "" },
          { label: "Owner", value: input.ownerName ?? "" },
          { label: "Email", value: input.ownerEmail ?? "" },
        ]),
        ctaButton(input.queueUrl, "Check hostel"),
      ].join("\n"),
    }),
  };
}
