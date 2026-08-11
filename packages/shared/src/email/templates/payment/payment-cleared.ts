import {
  ctaButton,
  emailLayout,
  escapeHtml,
  monthName,
  paragraph,
  type EmailContent,
} from "../layout";

/**
 * The owner's side of a cleared payment.
 *
 * Until now only the resident was told when a claim was verified. That is the
 * wrong half of the pair to notify alone: the person who has to answer "did
 * Ram's rent come in?" is the owner, and the only record they had was a row
 * quietly leaving the review queue. It is also the confirmation that matters
 * when someone *else* on the staff approved it — an approval nobody else sees is
 * how two people chase the same resident.
 *
 * Deliberately not the same template as the resident's. The resident is being
 * thanked and handed a receipt; the owner is being told money landed, by whom,
 * and what is still outstanding.
 */
export function paymentClearedEmail(input: {
  amount: number;
  approvedBy?: string | null;
  currency?: string;
  hostelName: string;
  method: string;
  month: string;
  paymentsUrl: string;
  receiptNumber: string;
  remainingAmount: number;
  residentName: string;
}): EmailContent {
  const currency = input.currency ?? "NPR";
  const money = (value: number) =>
    `${escapeHtml(currency)} ${value.toLocaleString("en-US")}`;

  const facts = [
    `Resident: <strong>${escapeHtml(input.residentName)}</strong>`,
    `Amount: <strong>${money(input.amount)}</strong>`,
    `Method: <strong>${escapeHtml(input.method.replaceAll("_", " "))}</strong>`,
    `Period: <strong>${escapeHtml(monthName(input.month)) || "—"}</strong>`,
    input.receiptNumber
      ? `Receipt: <strong>${escapeHtml(input.receiptNumber)}</strong>`
      : "",
    input.approvedBy ? `Approved by: <strong>${escapeHtml(input.approvedBy)}</strong>` : "",
  ].filter(Boolean);

  return {
    subject: `Payment cleared — ${escapeHtml(input.residentName)} · ${monthName(input.month)}`,
    html: emailLayout({
      heading: "Payment cleared ✅",
      bodyHtml: [
        paragraph(
          `A payment at ${escapeHtml(input.hostelName)} has been verified and the resident's balance updated.`,
        ),
        `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.7;">${facts
          .map((fact) => `<li>${fact}</li>`)
          .join("")}</ul>`,
        input.remainingAmount > 0
          ? paragraph(
              `<strong>${money(input.remainingAmount)}</strong> is still outstanding for this period.`,
            )
          : paragraph("This period is now fully settled."),
        ctaButton(input.paymentsUrl, "Open payments"),
      ].join("\n"),
    }),
  };
}
