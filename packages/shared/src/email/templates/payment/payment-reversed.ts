import { ctaButton, emailLayout, escapeHtml, monthName, paragraph, type EmailContent } from "../layout";

/**
 * A settled payment was reversed (target §9.3).
 *
 * This email exists because the alternative is worse than any wording could be:
 * a resident whose payment silently stops counting discovers it from a dunning
 * notice, and the hostel discovers it from an angry phone call. The reason is
 * mandatory upstream and is stated plainly here — a reversal the resident cannot
 * explain is the same support disaster as one they were never told about.
 */
export function paymentReversedEmail(input: {
  amount: number;
  currency?: string;
  hostelName: string;
  outstandingAmount: number;
  paymentsUrl: string;
  period?: string | null;
  reason: string;
  residentName: string;
}): EmailContent {
  const currency = input.currency ?? "NPR";
  const forPeriod = input.period ? ` for <strong>${escapeHtml(monthName(input.period))}</strong>` : "";

  return {
    category: "billing",
    subject: `Payment reversed${input.period ? ` — ${input.period}` : ""} · ${input.hostelName}`,
    html: emailLayout({
      heading: "A payment was reversed",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, ${escapeHtml(input.hostelName)} has reversed a recorded payment of <strong>${escapeHtml(currency)} ${input.amount.toLocaleString("en-US")}</strong>${forPeriod}.`,
        ),
        paragraph(`Reason given: <strong>${escapeHtml(input.reason)}</strong>`),
        paragraph(
          input.outstandingAmount > 0
            ? `Your outstanding balance is now <strong>${escapeHtml(currency)} ${input.outstandingAmount.toLocaleString("en-US")}</strong>. Any receipt issued for this payment has been voided.`
            : "Any receipt issued for this payment has been voided. Nothing is currently outstanding.",
        ),
        paragraph(
          "If this looks wrong, contact your hostel — reversals are recorded and can be traced.",
        ),
        ctaButton(input.paymentsUrl, "View payments"),
      ].join("\n"),
    }),
  };
}
