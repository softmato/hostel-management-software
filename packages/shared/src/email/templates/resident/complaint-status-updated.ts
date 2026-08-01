import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

const STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "in progress",
  PENDING: "pending",
  REJECTED: "closed without action",
  RESOLVED: "resolved",
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
    subject: `Your complaint is now ${label} — ${input.hostelName}`,
    html: emailLayout({
      heading: "Complaint update",
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(input.hostelName)}</strong> updated your complaint <strong>${escapeHtml(input.title)}</strong>.`,
        ),
        paragraph(`Status: <strong>${escapeHtml(label)}</strong>`),
        input.response
          ? paragraph(`Note from the hostel: “${escapeHtml(input.response)}”`)
          : "",
        ctaButton(input.complaintsUrl, "View the complaint"),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
