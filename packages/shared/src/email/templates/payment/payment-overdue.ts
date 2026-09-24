import {
  ctaButton,
  emailDate,
  emailLayout,
  escapeHtml,
  monthName,
  paragraph,
  type EmailContent,
} from "../layout";

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
    category: "alert",
    subject: `Please pay your hostel fee — ${monthName(input.month)} · ${input.hostelName}`,
    html: emailLayout({
      heading: "Your hostel fee is late",
      urgent: true,
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, your <strong>${escapeHtml(monthName(input.month))}</strong> fee at ${escapeHtml(input.hostelName)} is <strong>${input.daysOverdue} ${dayLabel}</strong> late. Please pay now.`,
        ),
        paragraph(
          `To pay: <strong>${escapeHtml(currency)} ${input.amount.toLocaleString("en-US")}</strong><br/>Last date was: <strong>${escapeHtml(emailDate(input.dueDate) ?? "")}</strong>`,
        ),
        paragraph(
          "Already paid? Send a photo of the payment so the hostel can check it.",
        ),
        ctaButton(input.paymentsUrl, "Send payment photo"),
      ].join("\n"),
    }),
  };
}
