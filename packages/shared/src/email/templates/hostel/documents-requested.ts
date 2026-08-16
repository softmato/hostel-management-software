import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

export function hostelDocumentsRequestedEmail(input: {
  documents: { documentType: string; note?: string }[];
  hostelName: string;
  note?: string;
  ownerName?: string;
  statusUrl: string;
}): EmailContent {
  const listItems = input.documents
    .map((doc) => {
      const detail = doc.note ? ` — ${escapeHtml(doc.note)}` : "";
      return `<li style="margin-bottom:6px;"><strong>${escapeHtml(doc.documentType)}</strong>${detail}</li>`;
    })
    .join("\n");

  return {
    category: "info",
    subject: `Action needed on your hostel registration — ${input.hostelName}`,
    html: emailLayout({
      heading: "We need a few more documents",
      bodyHtml: [
        paragraph(
          `Hi${input.ownerName ? ` ${escapeHtml(input.ownerName)}` : ""}, our team reviewed your registration for <strong>${escapeHtml(input.hostelName)}</strong> and needs some additional documents before we can approve it.`,
        ),
        input.note ? paragraph(escapeHtml(input.note)) : "",
        `<ul style="padding-left:20px;margin:0 0 16px;color:#334155;">${listItems}</ul>`,
        paragraph(
          "Please open your registration and upload the requested documents. Once submitted, your application returns to our review queue.",
        ),
        ctaButton(input.statusUrl, "Provide documents"),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
