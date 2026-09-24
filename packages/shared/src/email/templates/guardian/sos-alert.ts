import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/**
 * Highest-priority template in the system (EMAIL_SYSTEM.md §5.1). Goes to hostel
 * admins, active wardens and — when the resident allowed emergency access — the
 * linked guardian. Never suppressed by an email-preference toggle.
 */
export function sosAlertEmail(input: {
  actionUrl: string;
  hostelName: string;
  message?: string;
  recipientKind: "STAFF" | "GUARDIAN";
  residentName: string;
  residentPhone?: string;
  triggeredAt: Date;
}): EmailContent {
  const time = input.triggeredAt.toISOString().replace("T", " ").slice(0, 16);
  const lead =
    input.recipientKind === "GUARDIAN"
      ? `<strong>${escapeHtml(input.residentName)}</strong> pressed SOS at <strong>${escapeHtml(input.hostelName)}</strong>. They need help. The hostel staff also got this message.`
      : `<strong>${escapeHtml(input.residentName)}</strong> pressed SOS at <strong>${escapeHtml(input.hostelName)}</strong>. They need help. Please go now.`;

  return {
    category: "alert",
    subject: `SOS: ${input.residentName} needs help — ${input.hostelName}`,
    html: emailLayout({
      heading: "🚨 SOS — needs help now",
      urgent: true,
      bodyHtml: [
        paragraph(lead),
        paragraph(`Time: ${escapeHtml(time)} UTC.`),
        input.residentPhone
          ? paragraph(`Resident phone: <strong>${escapeHtml(input.residentPhone)}</strong>`)
          : "",
        input.message
          ? paragraph(`Message: “${escapeHtml(input.message)}”`)
          : "",
        ctaButton(input.actionUrl, "Open SOS"),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
