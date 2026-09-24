import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
import { formatRupees } from "./subscription-invoice";

/**
 * "We could not match this one" — the other half of the promise.
 *
 * `subscriptionClaimReceivedEmail` commits to writing back either way, and this
 * is the way that is not a receipt. It is the harder email of the two and the
 * one worth getting right: the reader has paid money, or believes they have,
 * and is being told it did not land.
 *
 * ## It is not an accusation, and the wording carries that
 *
 * By far the commonest reasons a claim fails review are boring — the screenshot
 * was of the wrong transfer, the amount was short, the transfer is still
 * clearing at their bank, the proof was unreadable. So the heading says the
 * payment could not be *confirmed*, never that it was rejected or refused, and
 * `reason` is printed verbatim from what the reviewer wrote rather than being
 * mapped to a code. A person read this claim; the sentence they wrote is the
 * most useful thing in the email.
 *
 * ## The balance is restated, because it is the thing that just changed back
 *
 * Nothing was ever taken off the invoice — an `IN_REVIEW` row counts toward
 * nothing — but from the owner's side the money left their account and the
 * screen said "submitted", so the outstanding figure has to be said out loud
 * again or they will assume it moved. And the next step has to be one they can
 * take without replying: submit again with the right proof.
 */
export function subscriptionClaimRejectedEmail(input: {
  amount: number;
  hostelName: string;
  invoiceNumber: string;
  outstanding: number;
  ownerName?: string;
  planName: string;
  /** What the reviewer wrote. Printed as-is — it is the useful part. */
  reason?: string | null;
}): EmailContent {
  const greeting = input.ownerName
    ? `Hi ${escapeHtml(input.ownerName)},`
    : "Hi,";

  return {
    category: "billing",
    subject: `We could not find your payment — ${input.hostelName}`,
    html: emailLayout({
      heading: "We could not find your payment",
      bodyHtml: [
        paragraph(greeting),
        paragraph(
          `We checked your payment photo for <strong>${formatRupees(input.amount)}</strong> (bill <strong>${escapeHtml(input.invoiceNumber)}</strong>, <strong>${escapeHtml(input.hostelName)}</strong>). We did not get this money.`,
        ),
        input.reason
          ? paragraph(`Reason: <strong>${escapeHtml(input.reason)}</strong>`)
          : "",
        paragraph(
          `You still need to pay <strong>${formatRupees(input.outstanding)}</strong> for <strong>${escapeHtml(input.planName)}</strong>.`,
        ),
        paragraph(
          "If you did pay, send a clear screenshot again. It must show the amount, the date and the transaction ID. Bank payments can take one day to reach us, so you can also try again tomorrow.",
        ),
        paragraph(
          "Nothing else has changed. Need help? Reply to this email.",
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
