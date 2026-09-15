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
 * Proof that money was received against a plan invoice.
 *
 * Sent per payment, not per invoice — a hostel that pays in two instalments
 * gets two receipts, each stating what that instalment was and what is left.
 * `Receipt` one level down explains why an amended-in-place receipt is not
 * evidence, and the same reasoning holds here.
 *
 * When `outstanding` is above zero the email says so plainly rather than
 * congratulating somebody who still owes money. That case only arises on a
 * team-collected payment, where the hostel is already live and the balance is a
 * due — so the wording has to work for a reader whose listing is up and who is
 * nonetheless being asked for more. It carries no button: it is paperwork, and
 * the owner is asked to pay by the email that states the balance, not by this.
 */
export function subscriptionReceiptEmail(input: {
  amount: number;
  /** The receipt PDF is on this email. */
  attached?: boolean;
  dueBy?: string | null;
  hostelName: string;
  invoiceNumber: string;
  method: string;
  outstanding: number;
  planName: string;
  receiptNumber: string;
}): EmailContent {
  const settled = input.outstanding <= 0;
  const methodLabel = METHOD_LABELS[input.method] ?? input.method;

  return {
    category: "billing",
    subject: `Receipt ${input.receiptNumber} — ${formatRupees(input.amount)} received`,
    html: emailLayout({
      bodyHtml: [
        paragraph(
          `We have received your payment for <strong>${escapeHtml(input.planName)}</strong> on <strong>${escapeHtml(input.hostelName)}</strong>.`,
        ),
        detailsTable([
          { emphasis: true, label: "Amount received", value: formatRupees(input.amount) },
          { label: "Paid by", value: methodLabel },
          { label: "Receipt", value: input.receiptNumber },
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
        input.attached ? smallPrint("The receipt is attached to this email as a PDF.") : "",
      ]
        .filter(Boolean)
        .join("\n"),
      eyebrow: "Receipt",
      heading: settled ? "Payment received" : "Part payment received",
      preheader: settled
        ? `${formatRupees(input.amount)} received for ${input.planName}. Thank you.`
        : `${formatRupees(input.amount)} received. ${formatRupees(input.outstanding)} is still due.`,
    }),
  };
}
