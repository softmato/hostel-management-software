import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

const STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "in progress",
  PENDING: "pending",
  REJECTED: "closed",
  RESOLVED: "fixed",
};

export function complaintStatusUpdatedEmail(input: {
  complaintsUrl: string;
  hostelName: string;
  response?: string;
  status: string;
  title: string;
}): EmailContent {
  const label = STATUS_LABEL[input.status] ?? input.status.toLowerCase();

  return {
    category: "support",
    subject: `Your complaint is now ${label} — ${input.hostelName}`,
    html: emailLayout({
      heading: "Your complaint is updated",
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(input.hostelName)}</strong> updated your complaint <strong>${escapeHtml(input.title)}</strong>.`,
        ),
        paragraph(`Status: <strong>${escapeHtml(label)}</strong>`),
        input.response
          ? paragraph(`Note from the hostel: “${escapeHtml(input.response)}”`)
          : "",
        ctaButton(input.complaintsUrl, "See complaint"),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
