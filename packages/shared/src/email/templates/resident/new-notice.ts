import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

export function residentNewNoticeEmail(input: {
  body: string;
  category?: string;
  hostelName: string;
  isUrgent?: boolean;
  noticesUrl: string;
  title: string;
}): EmailContent {
  const preview =
    input.body.length > 400 ? `${input.body.slice(0, 400).trimEnd()}…` : input.body;
  const prefix = input.isUrgent ? "Urgent notice" : "New notice";

  return {
    subject: `${prefix}: ${input.title} — ${input.hostelName}`,
    html: emailLayout({
      heading: input.isUrgent ? "Urgent notice" : "New notice",
      urgent: input.isUrgent,
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(input.hostelName)}</strong> posted a new notice${input.category ? ` (${escapeHtml(input.category)})` : ""}.`,
        ),
        paragraph(`<strong>${escapeHtml(input.title)}</strong>`),
        paragraph(escapeHtml(preview).replace(/\n/g, "<br/>")),
        ctaButton(input.noticesUrl, "Read the full notice"),
      ].join("\n"),
    }),
  };
}
