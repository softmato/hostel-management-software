import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/** Sent to the hostel admin when a resident submits a payment proof. */
export function paymentProofUploadedEmail(input: {
  amount: number;
  currency?: string;
  hostelName: string;
  method?: string;
  month: string;
  referenceNote?: string;
  residentName: string;
  reviewUrl: string;
}): EmailContent {
  const currency = input.currency ?? "NPR";
  const detailLines = [
    `Resident: <strong>${escapeHtml(input.residentName)}</strong>`,
    `Month: <strong>${escapeHtml(input.month)}</strong>`,
    `Amount claimed: <strong>${escapeHtml(currency)} ${input.amount.toLocaleString("en-US")}</strong>`,
    input.method ? `Method: <strong>${escapeHtml(input.method)}</strong>` : null,
    input.referenceNote
      ? `Reference: <strong>${escapeHtml(input.referenceNote)}</strong>`
      : null,
  ].filter((line): line is string => line !== null);

  return {
    subject: `Payment proof to verify — ${input.residentName} · ${input.month}`,
    html: emailLayout({
      heading: "New payment proof submitted",
      bodyHtml: [
        paragraph(
          `A resident at <strong>${escapeHtml(input.hostelName)}</strong> uploaded a payment proof for your review.`,
        ),
        paragraph(detailLines.join("<br/>")),
        ctaButton(input.reviewUrl, "Review payment proof"),
      ].join("\n"),
    }),
  };
}
