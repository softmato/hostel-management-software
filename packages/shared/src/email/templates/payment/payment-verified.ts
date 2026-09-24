import { PLATFORM_NAME } from "../../../brand/brand";
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
  const amount = `${currency} ${input.amount.toLocaleString("en-US")}`;
  const balanceLine =
    input.remainingAmount > 0
      ? paragraph(
          `Still to pay this month: <strong>${escapeHtml(currency)} ${input.remainingAmount.toLocaleString("en-US")}</strong>.`,
        )
      : paragraph("This month's fee is fully paid. Thank you!");

  if (input.certificationCode) {
    return {
      category: "billing",
      subject: `Your payment is verified — ${monthName(input.month)} · ${input.hostelName}`,
      html: emailLayout({
        heading: "Payment verified ✅",
        bodyHtml: [
          paragraph(
            `Hi ${escapeHtml(input.residentName)}, your payment of <strong>${escapeHtml(amount)}</strong> for <strong>${escapeHtml(monthName(input.month))}</strong> is verified by ${escapeHtml(input.hostelName)}.`,
          ),
          paragraph(
            "Your receipt has been auto-applied to the <strong>Resident Offer Program</strong>.",
          ),
          detailsTable([
            { label: "Receipt number", value: input.receiptNumber },
            { emphasis: true, label: "Verification code", value: input.certificationCode },
          ]),
          balanceLine,
          paragraph(
            `You can view your payment receipt in the ${escapeHtml(PLATFORM_NAME)} app, under Offer Program. The PDF is attached to this email too.`,
          ),
          ctaButton(input.offerProgramUrl, "View your receipt"),
        ].join("\n"),
      }),
    };
  }

  return {
    category: "billing",
    subject: `Thank you! Your payment is received — ${monthName(input.month)} · ${input.hostelName}`,
    html: emailLayout({
      heading: "Payment received ✅",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, ${escapeHtml(input.hostelName)} got your payment of <strong>${escapeHtml(amount)}</strong> for <strong>${escapeHtml(monthName(input.month))}</strong>.`,
        ),
        paragraph(
          `Receipt number: <strong>${escapeHtml(input.receiptNumber)}</strong>`,
        ),
        balanceLine,
        ctaButton(input.paymentsUrl, "View receipt"),
        smallPrint(
          "This payment did not have its reference code, so it is not in the Resident Offer Program. Put the code in the remarks next time you pay.",
        ),
      ].join("\n"),
    }),
  };
}
