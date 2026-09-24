import {
  comparisonTable,
  ctaButton,
  emailLayout,
  escapeHtml,
  greeting,
  paragraph,
  smallPrint,
  type ComparisonRow,
  type EmailContent,
} from "../layout";

/**
 * "Confirm this change to <setting>."
 *
 * Sent to the superadmin who just saved a money setting — the booking terms or
 * the collection QR. Nothing has changed yet; the link is what applies it.
 *
 * Old and new sit side by side so the numbers are checked in the one place an
 * attacker holding the session cannot reach: the inbox. If the reader did not
 * make the change, the email says so plainly, because this is the only moment
 * they would find out.
 */
export function settingChangeConfirmEmail(input: {
  confirmUrl: string;
  expiresAt: string;
  name?: string | null;
  rows: ComparisonRow[];
  settingLabel: string;
  siteName?: string;
}): EmailContent {
  return {
    category: "security",
    subject: `Please confirm: ${input.settingLabel} change`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.name),
        paragraph(
          `You changed <strong>${escapeHtml(input.settingLabel)}</strong>. It is not saved until you confirm.`,
        ),
        comparisonTable(input.rows),
        ctaButton(input.confirmUrl, "Confirm change"),
        smallPrint(
          `This link works one time, until ${escapeHtml(input.expiresAt)}, only while you are logged in as this superadmin.`,
        ),
        smallPrint(
          "Not you? Do not open the link. Log out of all devices and change your Google password.",
        ),
      ].join(""),
      eyebrow: "Security",
      heading: "Please confirm this change",
      preheader: `Confirm the ${input.settingLabel} change. It is not saved until you do.`,
      siteName: input.siteName,
    }),
  };
}
