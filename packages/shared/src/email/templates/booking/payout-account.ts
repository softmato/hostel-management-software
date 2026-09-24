import { PLATFORM_NAME } from "../../../brand/brand";
import {
  ctaButton,
  detailsTable,
  emailLayout,
  escapeHtml,
  greeting,
  paragraph,
  smallPrint,
  type EmailContent,
} from "../layout";

type PayoutAccountFacts = {
  /** "Bank account", "eSewa", "Khalti". */
  methodLabel: string;
  holderName: string;
  bankName?: string | null;
  /** `••••4821` */
  maskedNumber: string;
};

function accountRows(account: PayoutAccountFacts) {
  return detailsTable([
    { label: "Paid to", value: account.methodLabel },
    { label: "Name on account", value: account.holderName },
    { label: "Bank", value: account.bankName ?? "" },
    { label: "Number", value: account.maskedNumber },
  ]);
}

/**
 * "Your payout account was changed."
 *
 * Goes to every admin of the hostel the moment the account the platform pays
 * booking shares into is set or changed. It is a security notice first: if an
 * admin did not make the change, this email is how they find out before any
 * money moves, and payouts already wait for our review of the new account.
 */
export function payoutAccountChangedEmail(input: {
  account: PayoutAccountFacts;
  changedAt: string;
  hostelName: string;
  name?: string | null;
  settingsUrl: string;
  supportEmail?: string | null;
}): EmailContent {
  return {
    category: "security",
    subject: `Payout account changed for ${input.hostelName}`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.name),
        paragraph(
          `The account where ${PLATFORM_NAME} sends <strong>${escapeHtml(input.hostelName)}</strong>'s booking money was changed on ${escapeHtml(input.changedAt)}.`,
        ),
        accountRows(input.account),
        paragraph("We check every new account before we send money to it."),
        ctaButton(input.settingsUrl, "View payout account"),
        smallPrint(
          input.supportEmail
            ? `Not you? Reply to this email or write to ${escapeHtml(input.supportEmail)} now.`
            : "Not you? Reply to this email now.",
        ),
      ].join(""),
      eyebrow: "Security",
      heading: "Payout account changed",
      preheader: `After we check it, money for ${input.hostelName} will go to ${input.account.methodLabel} ${input.account.maskedNumber}.`,
    }),
  };
}

/** "Your payout account is verified" — or "needs fixing", with our reason. */
export function payoutAccountReviewedEmail(input: {
  account: PayoutAccountFacts;
  approved: boolean;
  hostelName: string;
  name?: string | null;
  note?: string | null;
  settingsUrl: string;
}): EmailContent {
  return {
    category: "billing",
    subject: input.approved
      ? `Your payout account is OK — ${input.hostelName}`
      : `Please fix your payout account — ${input.hostelName}`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.name),
        paragraph(
          input.approved
            ? `We checked <strong>${escapeHtml(input.hostelName)}</strong>'s payout account. We will send booking money here.`
            : `We could not check <strong>${escapeHtml(input.hostelName)}</strong>'s payout account. We will not send money until it is fixed.`,
        ),
        accountRows(input.account),
        input.note ? paragraph(`<strong>Note:</strong> ${escapeHtml(input.note)}`) : "",
        ctaButton(input.settingsUrl, input.approved ? "View payout account" : "Fix payout account"),
      ].join(""),
      eyebrow: input.approved ? "Checked" : "Please fix",
      heading: input.approved ? "Your payout account is OK" : "Please fix your payout account",
      preheader: input.approved
        ? `Booking payouts for ${input.hostelName} will go to ${input.account.maskedNumber}.`
        : `Money for ${input.hostelName} is stopped until the account is fixed.`,
      urgent: !input.approved,
    }),
  };
}
