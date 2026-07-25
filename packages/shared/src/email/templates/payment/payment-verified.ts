import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

export function paymentVerifiedEmail(input: {
  amount: number;
  currency?: string;
  hostelName: string;
  month: string;
  paymentsUrl: string;
  receiptNumber: string;
  remainingAmount: number;
  residentName: string;
}): EmailContent {
  const currency = input.currency ?? "NPR";
  const balanceLine =
    input.remainingAmount > 0
      ? paragraph(
          `Remaining balance for this month: <strong>${escapeHtml(currency)} ${input.remainingAmount.toLocaleString("en-US")}</strong>.`,
        )
      : paragraph("This month's fee is now fully settled. Thank you!");

  return {
    subject: `Payment verified — ${input.month} · ${input.hostelName}`,
    html: emailLayout({
      heading: "Payment verified ✅",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, ${escapeHtml(input.hostelName)} has verified your payment of <strong>${escapeHtml(currency)} ${input.amount.toLocaleString("en-US")}</strong> for <strong>${escapeHtml(input.month)}</strong>.`,
        ),
        paragraph(
          `Receipt number: <strong>${escapeHtml(input.receiptNumber)}</strong>`,
        ),
        balanceLine,
        ctaButton(input.paymentsUrl, "View receipt"),
      ].join("\n"),
    }),
  };
}
