import { ctaButton, emailLayout, escapeHtml, monthName, paragraph, type EmailContent } from "../layout";

/** Sent to the hostel admin when a resident submits a payment proof. */
export function paymentProofUploadedEmail(input: {
  amount: number;
  currency?: string;
  hostelName: string;
  invoiceReference?: string;
  method?: string;
  month: string;
  referenceNote?: string;
  residentName: string;
  reviewUrl: string;
  transactionCode?: string;
}): EmailContent {
  const currency = input.currency ?? "NPR";
  const detailLines = [
    `Resident: <strong>${escapeHtml(input.residentName)}</strong>`,
    `Month: <strong>${escapeHtml(monthName(input.month))}</strong>`,
    `Amount claimed: <strong>${escapeHtml(currency)} ${input.amount.toLocaleString("en-US")}</strong>`,
    input.method ? `Method: <strong>${escapeHtml(input.method)}</strong>` : null,
    // Three different things were all being labelled "Reference": the
    // invoice's matching code, the resident's free-text note, and the
    // provider's transaction id. The email showed the note (falling back to
    // the transaction id) under the invoice code's name, so an owner reading
    // "Reference: 9876545678" reasonably concluded the resident had quoted
    // the code when they had typed a transaction id into a different box.
    input.transactionCode
      ? `Transaction ID: <strong>${escapeHtml(input.transactionCode)}</strong>`
      : null,
    input.invoiceReference
      ? `Invoice reference: <strong>${escapeHtml(input.invoiceReference)}</strong>`
      : null,
    input.referenceNote
      ? `Note from resident: <strong>${escapeHtml(input.referenceNote)}</strong>`
      : null,
  ].filter((line): line is string => line !== null);

  return {
    subject: `Payment proof to verify — ${input.residentName} · ${monthName(input.month)}`,
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
