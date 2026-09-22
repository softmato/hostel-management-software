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
      ? `${formatRupees(input.amount)} received — your ${input.planName} plan is active`
      : `${formatRupees(input.amount)} received — ${formatRupees(input.outstanding)} still due`,
    html: emailLayout({
      bodyHtml: [
        paragraph(
          `We have received your payment for <strong>${escapeHtml(input.planName)}</strong> on <strong>${escapeHtml(input.hostelName)}</strong>.`,
        ),
        detailsTable([
          { emphasis: true, label: "Amount received", value: formatRupees(input.amount) },
          { label: "Paid by", value: methodLabel },
          { label: "Invoice", value: input.invoiceNumber },
          ...(settled
            ? []
            : [
                { label: "Balance due", value: formatRupees(input.outstanding) },
                { label: "Due date", value: input.dueBy ?? "" },
              ]),
        ]),
        paragraph(
          settled
            ? "That settles the invoice in full. Your plan is active and your listing is live."
            : "Your listing stays live while you pay the balance.",
        ),
        smallPrint(
          input.attached
            ? "Your receipt and invoice are attached to this email."
            : "You can download your receipt from your billing page.",
        ),
      ].join("\n"),
      eyebrow: "Payment received",
      heading: settled ? "Payment received" : "Part payment received",
      preheader: settled
        ? `${formatRupees(input.amount)} received for ${input.planName}.`
        : `${formatRupees(input.amount)} received. ${formatRupees(input.outstanding)} is still due.`,
    }),
  };
}
