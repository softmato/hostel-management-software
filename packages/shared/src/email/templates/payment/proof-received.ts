import {
  ctaButton,
  emailLayout,
  escapeHtml,
  monthName,
  paragraph,
  type EmailContent,
} from "../layout";

/**
 * Sent to the **resident** the moment they submit a payment proof.
 *
 * The gap this fills: submitting a claim mailed the hostel's admins and told the
 * resident nothing. From their side the money had left their bank, they had
 * uploaded a screenshot, and then silence — until either a verification email or,
 * more often, a dunning notice for a month they had already paid. The support
 * call that follows is always the same question, and it is a question this email
 * answers for free.
 *
 * **It promises nothing about the money.** A claim is unconfirmed by
 * construction: nothing has been credited, no balance has moved, and a reviewer
 * may yet reject it. So the wording is "received, and being checked" throughout —
 * the one thing worse than no email here would be one a resident reasonably reads
 * as "paid", because they will stop chasing a transfer that never arrived.
 */
export function paymentProofReceivedEmail(input: {
  amount: number;
  currency?: string;
  hostelName: string;
  month: string;
  offerProgramUrl: string;
  paymentsUrl: string;
  /** The invoice's code, when the resident quoted it — the programme's whole point. */
  referenceCode?: string | null;
  residentName: string;
}): EmailContent {
  const currency = input.currency ?? "NPR";
  const amount = `${escapeHtml(currency)} ${input.amount.toLocaleString("en-US")}`;

  return {
    category: "billing",
    subject: `Payment proof received — ${monthName(input.month)} · ${input.hostelName}`,
    html: emailLayout({
      heading: "We have your payment proof",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, we received your payment proof of <strong>${amount}</strong> for <strong>${escapeHtml(monthName(input.month))}</strong> and sent it to ${escapeHtml(input.hostelName)} to check.`,
        ),
        paragraph(
          "Nothing has been credited to your account yet — that happens once your hostel verifies it, and we will email you a receipt the moment they do.",
        ),
        // Named, not explained. The programme's own page carries the detail; an
        // email that tries to carry it too is a second copy of the wording to
        // keep in step, and this one is read in ten seconds on a phone.
        input.referenceCode
          ? paragraph(
              `This payment will be credited to your <strong>Resident Offer Program</strong> under reference <strong>${escapeHtml(input.referenceCode)}</strong>.`,
            )
          : paragraph(
              "This payment will be credited to your <strong>Resident Offer Program</strong> once it is verified.",
            ),
        paragraph(
          `<a href="${escapeHtml(input.offerProgramUrl)}">Read more about the Resident Offer Program</a>`,
        ),
        ctaButton(input.paymentsUrl, "Track this payment"),
      ].join("\n"),
    }),
  };
}
