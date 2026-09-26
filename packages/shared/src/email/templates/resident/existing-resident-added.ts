import { PLATFORM_NAME } from "../../../brand/brand";
import {
  ctaButton,
  detailsTable,
  emailLayout,
  escapeHtml,
  listTable,
  paragraph,
  sectionTitle,
  smallPrint,
  textLink,
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

  const money =
    total === 0
      ? [
          sectionTitle("Nothing to pay now"),
          detailsTable([
            { label: "Paid till", value: input.paidTill },
            { label: "Next bill", value: input.nextBillMonth },
          ]),
        ].join("\n")
      : [
          sectionTitle(`To pay by ${input.payBy}`),
          listTable(
            [{ label: "Bill" }, { label: "Code" }, { align: "right", label: "Amount" }],
            input.dues.map((due) => [due.label, due.code ?? "—", rupees(due.amount)]),
            input.dues.length > 1 ? ["Total", "", rupees(total)] : undefined,
          ),
          smallPrint("Write the code when you pay, so the hostel knows which bill you paid."),
        ].join("\n");

  const access = input.hasAccount
    ? [
        ctaButton(input.dashboardUrl, "Open my account"),
        smallPrint(`Log in to ${PLATFORM_NAME} with this email.`),
      ]
    : input.activation
      ? [
          ctaButton(input.activation.url, "Start my account"),
          smallPrint(`This link works till ${escapeHtml(input.activation.expiresOn)}.`),
        ]
      : [smallPrint("To use the app, ask the hostel for your code.")];

  return {
    category: "info",
    subject:
      total === 0
        ? `${input.hostelName} is now on ${PLATFORM_NAME}`
        : `${input.hostelName} is now on ${PLATFORM_NAME} — please pay ${rupees(total)}`,
    html: emailLayout({
      heading: `Your hostel is now on ${PLATFORM_NAME}`,
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, <strong>${escapeHtml(input.hostelName)}</strong> now uses ${PLATFORM_NAME}. You can pay rent and get receipts in the app.`,
        ),
        detailsTable([
          { label: "Room type", value: input.roomType },
          { label: "Monthly rent", value: input.monthlyRent ? rupees(input.monthlyRent) : "" },
          { label: "Deposit paid", value: input.depositPaid > 0 ? rupees(input.depositPaid) : "" },
        ]),
        money,
        ...access,
        smallPrint(
          `Every payment made with its code counts for the ${textLink(input.offerProgramUrl, "Resident Offer Program")}.`,
        ),
        smallPrint("Something wrong? Tell the hostel."),
      ].join("\n"),
    }),
  };
}
