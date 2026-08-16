import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/**
 * Delivers a platform ID card. Sent when a resident first completes their card,
 * and again whenever an approval re-issues it as a hostel owner or service
 * provider card. The card itself rides along as PNG attachments (front and
 * back) rather than inline images, so it survives clients that block remote
 * content and can be saved straight to a phone.
 */
export function idCardIssuedEmail(input: {
  /** "Resident", "Hostel Owner", "Service Provider". */
  cardLabel: string;
  holderName: string;
  residentId: string;
  siteName: string;
}): EmailContent {
  const card = `${input.cardLabel} ID card`;

  return {
    category: "info",
    subject: `Your ${input.siteName} ${card}`,
    html: emailLayout({
      heading: `Your ${card}`,
      siteName: input.siteName,
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.holderName)}, your <strong>${escapeHtml(card)}</strong> is attached to this email as a PNG — front and back.`,
        ),
        paragraph(
          `Your ID stays the same wherever you use it:<br/><strong style="font-size:22px;letter-spacing:3px;">${escapeHtml(input.residentId)}</strong>`,
        ),
        paragraph(
          `Save the images to your phone, or open your account on ${escapeHtml(input.siteName)} any time to view and download the card again.`,
        ),
        paragraph(
          "Do not share the card publicly. Anyone who scans the code can look up the details you have chosen to share.",
        ),
      ].join("\n"),
    }),
  };
}
