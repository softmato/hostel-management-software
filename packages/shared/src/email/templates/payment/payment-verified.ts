import {
  ctaButton,
  detailsTable,
  emailLayout,
  escapeHtml,
  monthName,
  paragraph,
  smallPrint,
  type EmailContent,
} from "../layout";

export function paymentVerifiedEmail(input: {
  amount: number;
  /**
   * Set when the receipt went into the Resident Offer Program — reference code
   * quoted, payment verified. The email then says so and names the code.
   */
  certificationCode?: string | null;
  currency?: string;
  hostelName: string;
  month: string;
  /** The resident's certified receipts, in the app. */
  offerProgramUrl: string;
  paymentsUrl: string;
  receiptNumber: string;
  remainingAmount: number;
  residentName: string;
}): EmailContent {
  const currency = input.currency ?? "NPR";
  const money = (value: number) => `${currency} ${value.toLocaleString("en-US")}`;
  const certified = Boolean(input.certificationCode);

  return {
    category: "billing",
    subject: `Payment received — ${monthName(input.month)} · ${input.hostelName}`,
    html: emailLayout({
      heading: "Payment received",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, ${escapeHtml(input.hostelName)} got your payment. Thank you.`,
        ),
        detailsTable([
          { emphasis: true, label: "Amount", value: money(input.amount) },
          { label: "Month", value: monthName(input.month) },
          { label: "Receipt number", value: input.receiptNumber },
          {
            label: "Still to pay",
            value: input.remainingAmount > 0 ? money(input.remainingAmount) : "Nothing",
          },
          { label: "Verification code", value: input.certificationCode ?? "" },
        ]),
        smallPrint(
          certified
            ? "This receipt counts for the Resident Offer Program."
            : "Next time, write your reference code when you pay, so it counts for the Resident Offer Program.",
        ),
        ctaButton(certified ? input.offerProgramUrl : input.paymentsUrl, "View receipt"),
      ].join("\n"),
    }),
  };
}
