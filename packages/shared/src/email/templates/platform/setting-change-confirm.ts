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
    subject: `Confirm the change to ${input.settingLabel}`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.name),
        paragraph(
          `You changed <strong>${escapeHtml(input.settingLabel)}</strong>. Nothing is saved until you confirm it.`,
        ),
        comparisonTable(input.rows),
        ctaButton(input.confirmUrl, "Confirm change"),
        smallPrint(
          `The link works once, only while you are signed in as this superadmin, until ${escapeHtml(input.expiresAt)}.`,
        ),
        smallPrint(
          "If you did not make this change, do not open the link. Sign out of every device and secure your Google account.",
        ),
      ].join(""),
      eyebrow: "Security",
      heading: "Confirm a settings change",
      preheader: `Confirm the change to ${input.settingLabel}. Nothing is saved until you do.`,
      siteName: input.siteName,
    }),
  };
}
