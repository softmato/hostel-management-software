import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
import { formatRupees } from "./subscription-invoice";

/**
 * "We have your proof, and nothing is switching off while we look at it."
 *
 * Sent the moment an owner submits a manual payment claim against a plan
 * invoice — they scanned our collection QR, paid from their own banking app,
 * and sent back the screenshot. Until a person on the platform side has looked
 * at it, no money has been recorded: the row is `IN_REVIEW` and counts toward
 * nothing.
 *
 * ## The email exists to answer the two questions the owner has left
 *
 * *Did it arrive?* and *what happens to my hostel in the meantime?* An owner
 * who has just paid real money out of their own bank and watched the app say
 * "submitted" has no way to tell those apart from silence, and silence is what
 * makes them pay a second time.
 *
 * So it states the amount and the invoice back to them — so a wrong figure is
 * caught by the payer, who is the only person who can catch it — commits to a
 * window, and says plainly that the plan keeps working. `worksUntil` is the
 * date their plan is paid up to when we know one; without it the sentence still
 * has to be true, so it says the listing stays live rather than naming a day.
 *
 * ## It promises an email either way
 *
 * Because both outcomes send one: an approval issues the receipt through
 * `subscriptionReceiptEmail`, and a refusal sends
 * `subscriptionClaimRejectedEmail`. A promise of "we will let you know" that
 * only holds when the answer is yes is the promise this lane cannot afford —
 * the whole reason a manual fallback is tolerable is that the payer is never
 * left guessing.
 */
export function subscriptionClaimReceivedEmail(input: {
  amount: number;
  hostelName: string;
  invoiceNumber: string;
  ownerName?: string;
  planName: string;
  /** The owner's own reference from their banking app, when they gave one. */
  reference?: string | null;
  /** The day the plan is paid up to, already formatted for a reader. */
  worksUntil?: string | null;
}): EmailContent {
  const greeting = input.ownerName
    ? `Hi ${escapeHtml(input.ownerName)},`
    : "Hi,";

  return {
    category: "billing",
    subject: `We have your payment proof — ${formatRupees(input.amount)} for ${input.planName}`,
    html: emailLayout({
      heading: "Payment proof received",
      bodyHtml: [
        paragraph(greeting),
        paragraph(
          `Thank you — we have your proof of payment for <strong>${formatRupees(input.amount)}</strong> against <strong>${escapeHtml(input.planName)}</strong> on <strong>${escapeHtml(input.hostelName)}</strong>.`,
        ),
        paragraph(
          [
            `Against invoice: <strong>${escapeHtml(input.invoiceNumber)}</strong>`,
            input.reference
              ? `Your reference: <strong>${escapeHtml(input.reference)}</strong>`
              : "",
          ]
            .filter(Boolean)
            .join("<br/>"),
        ),
        paragraph(
          "Our team will verify it within <strong>1–2 working days</strong> and email you as soon as it is checked, whether or not everything matches.",
        ),
        paragraph(
          input.worksUntil
            ? `Nothing changes in the meantime. Your plan keeps working and your listing stays live until <strong>${escapeHtml(input.worksUntil)}</strong>.`
            : "Nothing changes in the meantime — your plan keeps working and your listing stays live while we check.",
        ),
        paragraph(
          "We are still setting up automatic payments. Until that is live, this is how plan payments reach us, and we are grateful for your patience with the extra step.",
        ),
      ].join("\n"),
    }),
  };
}
