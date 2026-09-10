import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
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
 * nonetheless being asked for more.
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
      heading: settled ? "Payment received" : "Part payment received",
      bodyHtml: [
        paragraph(
          `We have received <strong>${formatRupees(input.amount)}</strong> for <strong>${escapeHtml(input.planName)}</strong> on <strong>${escapeHtml(input.hostelName)}</strong>.`,
        ),
        paragraph(
          [
            `Receipt: <strong>${escapeHtml(input.receiptNumber)}</strong>`,
            `Against invoice: <strong>${escapeHtml(input.invoiceNumber)}</strong>`,
            `Paid by: <strong>${escapeHtml(methodLabel)}</strong>`,
          ].join("<br/>"),
        ),
        settled
          ? paragraph(
              "That settles the invoice in full. Your plan is active and your listing is live.",
            )
          : paragraph(
              [
                `Still outstanding: <strong>${formatRupees(input.outstanding)}</strong>.`,
                input.dueBy
                  ? `Please clear it by <strong>${escapeHtml(input.dueBy)}</strong>.`
                  : "",
                "Your listing stays live in the meantime — you can pay the balance from your dashboard whenever suits.",
              ]
                .filter(Boolean)
                .join(" "),
            ),
        ...(input.attached
          ? [paragraph("The receipt is attached to this email as a PDF.")]
          : []),
      ].join("\n"),
    }),
  };
}
