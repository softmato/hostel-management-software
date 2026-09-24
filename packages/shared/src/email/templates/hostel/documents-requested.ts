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
    subject: `Please send more documents — ${input.hostelName}`,
    html: emailLayout({
      heading: "Please send more documents",
      bodyHtml: [
        paragraph(
          `Hi${input.ownerName ? ` ${escapeHtml(input.ownerName)}` : ""}, we checked <strong>${escapeHtml(input.hostelName)}</strong>. We need a few more documents before we can say yes.`,
        ),
        input.note ? paragraph(escapeHtml(input.note)) : "",
        `<ul style="padding-left:20px;margin:0 0 16px;color:#334155;">${listItems}</ul>`,
        paragraph(
          "Please open your registration and upload these documents. Then we will check again.",
        ),
        ctaButton(input.statusUrl, "Upload documents"),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  };
}
