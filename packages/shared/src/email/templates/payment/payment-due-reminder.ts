import { ctaButton, emailLayout, escapeHtml, monthName, paragraph, type EmailContent } from "../layout";

export function paymentDueReminderEmail(input: {
  amount: number;
  currency?: string;
  dueDate: Date;
  hostelName: string;
  month: string;
  paymentsUrl: string;
  residentName: string;
}): EmailContent {
  const currency = input.currency ?? "NPR";

  return {
    subject: `Payment due soon — ${monthName(input.month)} · ${input.hostelName}`,
    html: emailLayout({
      heading: "Your hostel fee is due soon",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, your <strong>${escapeHtml(monthName(input.month))}</strong> fee at ${escapeHtml(input.hostelName)} is coming up.`,
        ),
        paragraph(
          `Amount due: <strong>${escapeHtml(currency)} ${input.amount.toLocaleString("en-US")}</strong><br/>Due date: <strong>${escapeHtml(input.dueDate.toDateString())}</strong>`,
        ),
        paragraph(
          "Pay through your usual method, then upload the payment proof so your hostel admin can verify it.",
        ),
        ctaButton(input.paymentsUrl, "Upload payment proof"),
      ].join("\n"),
    }),
  };
}
