import {
  ctaButton,
  detailsTable,
  emailLayout,
  escapeHtml,
  greeting,
  paragraph,
  smallPrint,
  type EmailContent,
} from "../layout";

/**
 * "Pay your plan by this date, or the hostel portal stops."
 *
 * Sent when a platform admin starts a suspension from Listings. It carries the
 * unpaid plan invoice — the one already outstanding, sent again — and one date.
 * Facts only: the amount, the invoice, the deadline and who loses access,
 * because the reader has to act on it, not be persuaded by it.
 */
export function planSuspensionNoticeEmail(input: {
  amount: number;
  hostelName: string;
  /** Whether the invoice document rides on this email. */
  invoiceAttached: boolean;
  invoiceNumber: string;
  ownerName?: string;
  /** The last day to pay, already worded for people (`emailDate`). */
  payBy: string;
  payUrl: string;
  planName: string;
}): EmailContent {
  const amount = `Rs ${input.amount.toLocaleString("en-IN")}`;

  return {
    category: "billing",
    subject: `Please pay your hostel plan fee by ${input.payBy} — ${input.hostelName}`,
    html: emailLayout({
      heading: "Your plan fee is not paid",
      bodyHtml: [
        greeting(input.ownerName),
        paragraph(
          `<strong>${escapeHtml(input.hostelName)}</strong> has not paid the plan fee. You need to pay <strong>${escapeHtml(amount)}</strong>.`,
        ),
        paragraph(
          `Please pay by <strong>${escapeHtml(input.payBy)}</strong>. If not, the app will stop working for you, your wardens, residents, guardians and cooks until you pay.`,
        ),
        detailsTable([
          { label: "Bill no.", value: input.invoiceNumber },
          { label: "Plan", value: input.planName },
          { emphasis: true, label: "To pay", value: amount },
          { label: "Pay by", value: input.payBy },
        ]),
        ctaButton(input.payUrl, "Pay now"),
        smallPrint(
          `${input.invoiceAttached ? "The bill is attached. " : ""}The app works again as soon as we get your payment.`,
        ),
      ].join("\n"),
    }),
  };
}
