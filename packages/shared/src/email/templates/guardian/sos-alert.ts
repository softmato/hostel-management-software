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
      ? `<strong>${escapeHtml(input.residentName)}</strong> has raised an emergency SOS at <strong>${escapeHtml(input.hostelName)}</strong>. Hostel staff have been alerted at the same time.`
      : `<strong>${escapeHtml(input.residentName)}</strong> has raised an emergency SOS at <strong>${escapeHtml(input.hostelName)}</strong>. Respond immediately.`;

  return {
    subject: `URGENT: SOS raised by ${input.residentName} — ${input.hostelName}`,
    html: emailLayout({
      heading: "🚨 Emergency SOS",
      urgent: true,
      bodyHtml: [
        paragraph(lead),
        paragraph(`Raised at ${escapeHtml(time)} UTC.`),
        input.residentPhone
          ? paragraph(`Resident phone: <strong>${escapeHtml(input.residentPhone)}</strong>`)
          : "",
        input.message
          ? paragraph(`Message from the resident: “${escapeHtml(input.message)}”`)
          : "",
        ctaButton(input.actionUrl, "Open the alert"),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
