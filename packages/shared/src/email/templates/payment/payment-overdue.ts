import { ctaButton, emailLayout, escapeHtml, monthName, paragraph, type EmailContent } from "../layout";

export function paymentOverdueEmail(input: {
  amount: number;
  currency?: string;
  daysOverdue: number;
  dueDate: Date;
  hostelName: string;
  month: string;
  paymentsUrl: string;
  residentName: string;
}): EmailContent {
  const currency = input.currency ?? "NPR";
  const dayLabel = input.daysOverdue === 1 ? "day" : "days";

  return {
    subject: `Payment overdue — ${monthName(input.month)} · ${input.hostelName}`,
    html: emailLayout({
      heading: "Your hostel fee is overdue",
      urgent: true,
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, your <strong>${escapeHtml(monthName(input.month))}</strong> fee at ${escapeHtml(input.hostelName)} is <strong>${input.daysOverdue} ${dayLabel}</strong> past its due date.`,
        ),
        paragraph(
          `Amount due: <strong>${escapeHtml(currency)} ${input.amount.toLocaleString("en-US")}</strong><br/>Due date was: <strong>${escapeHtml(input.dueDate.toDateString())}</strong>`,
        ),
        paragraph(
          "If you have already paid, upload your payment proof so the record can be verified and closed.",
        ),
        ctaButton(input.paymentsUrl, "Upload payment proof"),
      ].join("\n"),
    }),
  };
}
