import { PLATFORM_NAME } from "../../../brand/brand";
import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/** A resident was given a Resident Offer Program perk for a quarter. */
export function offerAwardedEmail(input: {
  kind: "FEE_OFF" | "GIFT";
  offerProgramUrl: string;
  percentOff?: number | null;
  /** `Shrawan – Aswin 2083 BS` */
  quarterLabel: string;
  residentName: string;
  title: string;
}): EmailContent {
  const how =
    input.kind === "FEE_OFF"
      ? `It comes off your next monthly fee: ${escapeHtml(PLATFORM_NAME)} pays ${input.percentOff ?? 0}% of it to your hostel for you. You do not need to do anything.`
      : `Our team will contact you to hand it over.`;

  return {
    category: "info",
    subject: `You got an offer: ${input.title} · Resident Offer Program`,
    html: emailLayout({
      heading: "You got an offer",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, thank you for paying with your reference code in <strong>${escapeHtml(input.quarterLabel)}</strong>. ${escapeHtml(PLATFORM_NAME)} is giving you:`,
        ),
        paragraph(`<strong>${escapeHtml(input.title)}</strong>`),
        paragraph(how),
        ctaButton(input.offerProgramUrl, "See your offers"),
      ].join("\n"),
    }),
  };
}
