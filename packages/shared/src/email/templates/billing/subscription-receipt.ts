import {
  detailsTable,
  emailLayout,
  escapeHtml,
  paragraph,
  smallPrint,
  type EmailContent,
} from "../layout";
import { formatRupees } from "./subscription-invoice";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  /*
   * Not the wallet's name. The payer chose eSewa or Khalti on Softmato's
   * checkout page, and which one they chose is on Softmato's own receipt —
   * this email should not guess at it, and naming the wrong wallet on a
   * payment record is worse than naming none.
   */
  SOFTMATO: "Online payment",
};

/**
 * Money received against a plan invoice, and what it switched on — for money
 * Softmato never saw. A payment that went through Softmato is receipted by
 * their own email, so this one is not sent for it (`onPaymentSettled`).
 *
 * When `outstanding` is above zero the email says so plainly rather than
 * congratulating somebody who still owes money.
 */
export function subscriptionReceiptEmail(input: {
  amount: number;
  attached?: boolean;
  dueBy?: string | null;
  hostelName: string;
  invoiceNumber: string;
  method: string;
  outstanding: number;
  planName: string;
}): EmailContent {
  const settled = input.outstanding <= 0;
  const methodLabel = METHOD_LABELS[input.method] ?? input.method;

  return {
    category: "billing",
    subject: settled
      ? `We got your ${formatRupees(input.amount)} payment`
      : `We got ${formatRupees(input.amount)}. ${formatRupees(input.outstanding)} left to pay`,
    html: emailLayout({
      bodyHtml: [
        paragraph(
          `We got your payment for <strong>${escapeHtml(input.planName)}</strong> (<strong>${escapeHtml(input.hostelName)}</strong>).`,
        ),
        detailsTable([
          { emphasis: true, label: "Paid", value: formatRupees(input.amount) },
          { label: "Paid with", value: methodLabel },
          { label: "Bill no.", value: input.invoiceNumber },
          ...(settled
            ? []
            : [
                { label: "Left to pay", value: formatRupees(input.outstanding) },
                { label: "Pay by", value: input.dueBy ?? "" },
              ]),
        ]),
        paragraph(
          settled
            ? "Your bill is fully paid. Your plan is on and your hostel shows online."
            : "Your hostel stays online while you pay the rest.",
        ),
        smallPrint(
          input.attached
            ? "Your receipt and bill are attached."
            : "You can download your receipt from your billing page.",
        ),
      ].join("\n"),
      eyebrow: "Payment received",
      heading: settled ? "Thank you, we got your payment" : "We got part of your payment",
      preheader: settled
        ? `We got ${formatRupees(input.amount)} for ${input.planName}.`
        : `We got ${formatRupees(input.amount)}. ${formatRupees(input.outstanding)} left to pay.`,
    }),
  };
}
