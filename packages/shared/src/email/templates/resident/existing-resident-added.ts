import { PLATFORM_NAME } from "../../../brand/brand";
import {
  ctaButton,
  emailLayout,
  escapeHtml,
  paragraph,
  type EmailContent,
} from "../layout";

/**
 * The one email a resident gets when their hostel adds them from the
 * existing-residents list (docs/EXISTING_RESIDENTS.md).
 *
 * They did not just move in — they have lived there for months, and the hostel
 * has started using the platform. So this is not "you are registered": it is
 * "your hostel is here now, this is what it has on record for you, and this is
 * what you owe today". Either "nothing to pay" or the months due, each with the
 * code to quote, and one way into the app.
 *
 * Plain English a Nepali reader already knows from bank and wallet messages —
 * "due", "pay by", "code" — and every month and date already formatted in
 * Bikram Sambat by the caller, since that is the calendar on their receipt book.
 */
export function existingResidentAddedEmail(input: {
  /** A link that sets up their app account, when they have none yet. */
  activation: { expiresOn: string; url: string } | null;
  dashboardUrl: string;
  /** The public Resident Offer Program page. */
  offerProgramUrl: string;
  depositPaid: number;
  /** Open bills, oldest first. Empty means nothing is due. */
  dues: { amount: number; code: string | null; label: string }[];
  hasAccount: boolean;
  hostelName: string;
  monthlyRent: number | null;
  /** `Kartik 2083` — the first month that will be billed from here on. */
  nextBillMonth: string;
  /** `Aswin 2083` — the last month paid, when nothing is due. */
  paidTill: string;
  /** `Aswin 31, 2083 BS` */
  payBy: string;
  residentName: string;
  roomType: string;
}): EmailContent {
  const rupees = (value: number) => `Rs ${value.toLocaleString("en-IN")}`;
  const total = input.dues.reduce((sum, due) => sum + due.amount, 0);

  const facts = [
    `Hostel: <strong>${escapeHtml(input.hostelName)}</strong>`,
    `Room type: <strong>${escapeHtml(input.roomType)}</strong>`,
    input.monthlyRent ? `Monthly rent: <strong>${rupees(input.monthlyRent)}</strong>` : "",
    input.depositPaid > 0 ? `Deposit paid: <strong>${rupees(input.depositPaid)}</strong>` : "",
  ].filter(Boolean);

  const money =
    total === 0
      ? paragraph(
          `Your rent is all clear till <strong>${escapeHtml(input.paidTill)}</strong>. Nothing to pay now. Your next bill is for <strong>${escapeHtml(input.nextBillMonth)}</strong>.`,
        )
      : [
          paragraph(
            `You have <strong>${rupees(total)}</strong> due. Please pay by <strong>${escapeHtml(input.payBy)}</strong>.`,
          ),
          `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 16px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;">${input.dues
            .map(
              (due, index) =>
                `<tr><td style="padding:10px 12px;${index ? "border-top:1px solid #e2e8f0;" : ""}">${escapeHtml(due.label)}${
                  due.code
                    ? `<br/><span style="color:#64748b;font-size:12px;">Code ${escapeHtml(due.code)}</span>`
                    : ""
                }</td><td align="right" style="padding:10px 12px;font-weight:600;${index ? "border-top:1px solid #e2e8f0;" : ""}">${rupees(due.amount)}</td></tr>`,
            )
            .join("")}</table>`,
          paragraph(
            "Mention the code when you pay, so the hostel can match your payment to the right bill.",
          ),
        ].join("\n");

  const access = input.hasAccount
    ? [
        paragraph(
          `Sign in to ${PLATFORM_NAME} with this email and press <strong>Continue</strong> to see your dashboard.`,
        ),
        ctaButton(input.dashboardUrl, "Open my account"),
      ]
    : input.activation
      ? [
          paragraph(
            `Set up your ${PLATFORM_NAME} account to see your bills, pay rent, get notices and more. This link works till ${escapeHtml(input.activation.expiresOn)}.`,
          ),
          ctaButton(input.activation.url, "Set up my account"),
        ]
      : [paragraph("Ask the hostel for your activation code to use the app.")];

  return {
    category: "info",
    subject:
      total === 0
        ? `Congratulations! ${input.hostelName} is now on ${PLATFORM_NAME}`
        : `${input.hostelName} is now on ${PLATFORM_NAME} — ${rupees(total)} due`,
    html: emailLayout({
      heading: `Your hostel is now on ${PLATFORM_NAME}`,
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, congratulations — <strong>${escapeHtml(input.hostelName)}</strong> now uses ${PLATFORM_NAME}. This is what the hostel has for you.`,
        ),
        `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.7;">${facts
          .map((fact) => `<li>${fact}</li>`)
          .join("")}</ul>`,
        money,
        paragraph(
          `From now on, pay your rent or submit your payment in the ${PLATFORM_NAME} app or on the web, and you get a certified receipt for it. Every payment made with its code also keeps you in the <a href="${escapeHtml(input.offerProgramUrl)}" style="color:#0f766e;">Resident Offer Program</a>, where gifts for residents are coming — given out at random.`,
        ),
        paragraph(
          "You can also see your bills, notices, meals and complaints any time — in the app or on the web.",
        ),
        ...access,
        paragraph("If anything here is wrong, tell the hostel."),
      ].join("\n"),
    }),
  };
}
